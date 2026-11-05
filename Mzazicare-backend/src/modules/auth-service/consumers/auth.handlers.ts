/**
 * U-CS 67 — Secure User Registration & Authentication System
 * Owner(s): Stephen Nyariki, Cyril John Tike Sinari
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * The module's reactions to events published by OTHER modules.
 *
 * src/server.ts imports this file for its side effects, so every `on()`
 * registered here is wired up at boot — BEFORE the event worker starts
 * draining the queue.
 *
 * auth-service is the ROOT of the dependency graph: nothing depends on it,
 * so it has nothing to react to. It only PUBLISHES events
 * (user.registered, user.logged_in, user.password.changed) and the other
 * eleven modules are the ones listening. This file therefore stays empty by
 * design — if it ever grows handlers, that is a signal something started
 * depending on auth.
 */
export {};