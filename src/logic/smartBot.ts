/**
 * SmartBotController (bots.md): the Easy/Normal/Hard bots, and with a human profile the reference
 * humans of the simulator. It speaks the ordinary player interface: it reads an Observation and
 * returns ordinary GameActions (selectTarget, startAttempt, playCard, chooseCards,
 * minigameResult), checked with the same validators the UI uses.
 *
 * Timing is scheduled on the game clock (`state.timeMs`), so pause freezes every delay. Random
 * draws: the `bot` stream is used only for the attempt roll (two draws per attempt, as before);
 * everything else (delays, route, offers, card targets) comes from `botMind`. The stream state
 * lives here, not in GameState (bots.md §12).
 */
import type { GameAction } from './actions';
import { botChooseDiscard, botChooseOffer, botChooseRoute, botPickCardToPlay, isAheadOfSchedule, simulateAttempt, type SimulatedAttempt } from './botDecisions';
import { observe, type Observation } from './botObservation';
import { BOT_PROFILE, type BotProfile, type Range } from './botProfiles';
import type { BotActivity, PlayerController } from './controllers';
import type { MapGraph } from './map';
import { canStartAttempt } from './reducer';
import { createStream, type Rng } from './rng';
import { cooldownRemainingMs, getPlayer, type BotLevel, type GameState } from './state';

export class SmartBotController implements PlayerController {
  readonly profile: BotProfile;
  /** "bot": attempt simulation only. */
  private readonly simRng: Rng;
  /** "botMind": delays, route, offer / discard, card choice and targets. */
  private readonly mind: Rng;
  private plan: SimulatedAttempt | null = null;
  /** Game time when the current think / after-win delay ends; null = none scheduled yet. */
  private gateReadyAtMs: number | null = null;
  private nextEvalMs: number | null = null;
  private lastCardAtMs = -Infinity;
  private lastCopetAtMs: number | null = null;
  private braking = false;
  private brakeRecheckAtMs: number | null = null;
  private currentActivity: BotActivity | null = null;

  constructor(
    readonly playerId: string,
    matchSeed: number,
    levelOrProfile: BotLevel | BotProfile = 'normal',
  ) {
    this.profile = typeof levelOrProfile === 'string' ? BOT_PROFILE[levelOrProfile] : levelOrProfile;
    this.simRng = createStream(matchSeed, playerId, 'bot');
    this.mind = createStream(matchSeed, playerId, 'botMind');
  }

  activity(): BotActivity | null {
    return this.currentActivity;
  }

  nextAction(state: Readonly<GameState>, map: MapGraph): GameAction | null {
    const raw = getPlayer(state, this.playerId);
    if (!raw || state.status !== 'running' || raw.phase === 'finished') {
      this.currentActivity = null;
      return null;
    }
    const obs = observe(state, this.playerId);
    const action = this.decide(obs, map);
    const now = state.timeMs;
    this.currentActivity =
      obs.me.phase !== 'idle' || obs.me.offer || obs.me.discard
        ? null
        : this.braking
          ? 'braking'
          : this.gateReadyAtMs !== null && now < this.gateReadyAtMs
            ? 'thinking'
            : null;
    return action;
  }

  /**
   * Lower bound of the next game time a poll could change anything (see PlayerController). Pure:
   * it never draws or mutates, so it is safe to call between polls.
   */
  wakeAtMs(state: Readonly<GameState>): number {
    const me = getPlayer(state, this.playerId);
    if (!me || state.status !== 'running' || me.phase === 'finished') return Infinity;
    const now = state.timeMs;
    if (me.offer || me.discard) return now;
    if (me.phase === 'playing') return this.plan ? this.plan.resultAtMs : now;
    let wake = Infinity;
    if (me.hand.length > 0) wake = Math.min(wake, this.nextEvalMs ?? now);
    if (!me.targetId) {
      wake = Math.min(wake, this.gateReadyAtMs ?? now);
    } else if (this.gateReadyAtMs === null) {
      wake = Math.min(wake, me.cooldownUntilMs > now ? me.cooldownUntilMs : now);
    } else if (this.gateReadyAtMs > now) {
      wake = Math.min(wake, this.gateReadyAtMs);
    } else if (me.cooldownUntilMs > now) {
      wake = now; // the think ended inside the cooldown: the next poll drops the gate
    } else {
      wake = Math.min(wake, this.brakeRecheckAtMs !== null && this.brakeRecheckAtMs > now ? this.brakeRecheckAtMs : now);
    }
    return wake;
  }

  private draw(range: Range): number {
    return Math.round(this.mind.range(range[0], range[1]));
  }

  private decide(obs: Observation, map: MapGraph): GameAction | null {
    const { profile } = this;
    const me = obs.me;
    const id = this.playerId;
    const state = obs.state;
    const now = state.timeMs;

    // Card screens first: answered on the first poll after they open, as one atomic action (§6).
    if (me.offer) return { type: 'chooseCards', playerId: id, cardUids: botChooseOffer(obs, map, profile, this.mind) };
    if (me.discard) return { type: 'chooseCards', playerId: id, cardUids: botChooseDiscard(obs, profile) };

    if (me.phase === 'playing' && me.attempt) {
      this.plan ??= simulateAttempt(me.attempt, map, profile, this.simRng);
      if (now < this.plan.resultAtMs) return null;
      const r = this.plan;
      this.plan = null;
      this.braking = false;
      this.brakeRecheckAtMs = null;
      // After a win: read the cards, watch the walk, weigh the route (afterWinMs). After a fail the
      // next delay starts when the cooldown is over (below).
      this.gateReadyAtMs = r.passed ? now + this.draw(profile.afterWinMs) : null;
      return { type: 'minigameResult', playerId: id, passed: r.passed, timeTakenMs: r.timeTakenMs };
    }
    this.plan = null;

    // One card evaluation per tick, at most one card per evaluation (§7).
    if (me.hand.length > 0) {
      if (this.nextEvalMs === null) {
        this.nextEvalMs = now + this.draw(profile.tickMs);
      } else if (now >= this.nextEvalMs) {
        this.nextEvalMs = now + this.draw(profile.tickMs);
        if (now - this.lastCardAtMs >= profile.cardGapMs) {
          const play = botPickCardToPlay(obs, map, profile, this.mind, { lastCopetAtMs: this.lastCopetAtMs });
          if (play) {
            this.lastCardAtMs = now;
            if (me.hand.find((c) => c.uid === play.cardUid)?.defId === 'copet') this.lastCopetAtMs = now;
            return { type: 'playCard', playerId: id, cardUid: play.cardUid, ...(play.targetId ? { targetId: play.targetId } : {}) };
          }
        }
      }
    } else {
      this.nextEvalMs = null;
    }

    // Route: pick once per region; the bot never switches target (§5).
    if (!me.targetId) {
      this.gateReadyAtMs ??= now + this.draw(profile.thinkMs);
      if (now < this.gateReadyAtMs) return null;
      const targetId = botChooseRoute(obs, map, profile, this.mind);
      if (!targetId) return null;
      this.gateReadyAtMs = now + this.draw(profile.thinkMs);
      return { type: 'selectTarget', playerId: id, targetId };
    }

    // Mulai: after the think delay, after the cooldown, unless the leader brake holds it back (§4).
    const cooling = cooldownRemainingMs(state, me) > 0;
    if (this.gateReadyAtMs === null) {
      if (cooling) return null;
      this.gateReadyAtMs = now + this.draw(profile.thinkMs);
    }
    if (now < this.gateReadyAtMs) return null;
    if (cooling) {
      this.gateReadyAtMs = null; // think again once the cooldown has ended
      return null;
    }
    if (this.brakeRecheckAtMs !== null && now < this.brakeRecheckAtMs) return null;
    if (isAheadOfSchedule(obs, map, profile)) {
      this.braking = true;
      this.brakeRecheckAtMs = now + profile.restRecheckMs;
      return null;
    }
    this.braking = false;
    this.brakeRecheckAtMs = null;
    if (canStartAttempt(state, me) !== null) return null;
    this.gateReadyAtMs = null;
    return { type: 'startAttempt', playerId: id };
  }
}
