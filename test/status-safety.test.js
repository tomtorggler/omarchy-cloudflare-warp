const test = require('node:test')
const assert = require('node:assert/strict')
const M = require('../Model.js')

test('normal status labels require a successful command result', () => {
  assert.deepEqual(M.parseStatus('Status update: Connected', 'opaque newer failure', 1), {
    state: 'error', connected: false, error: 'WARP status command failed'
  })
  assert.deepEqual(M.parseStatus('Status update: Disconnected', '', 9), {
    state: 'error', connected: false, error: 'WARP status command failed'
  })
  assert.deepEqual(M.parseStatus('Status update: Connecting', 'opaque failure', 2), {
    state: 'error', connected: false, error: 'WARP status command failed'
  })
  assert.deepEqual(M.parseStatus('Status update: Connected', '', 0), {
    state: 'connected', connected: true, error: ''
  })
})

test('an anchored status with a no-network reason cannot look merely disconnected', () => {
  for (const raw of [
    'Status update: Disconnected\nReason: No Network',
    'Status update: Connected\nReason: Network is offline',
    'Status update: Connecting\nReason: Network unavailable'
  ]) {
    assert.deepEqual(M.parseStatus(raw, '', 0), {
      state: 'no-network', connected: false, error: 'Network is unavailable'
    })
  }

  assert.deepEqual(M.parseStatus('Status update: Disconnected\nReason: NoNetwork', '', 1), {
    state: 'no-network', connected: false, error: 'Network is unavailable'
  })
})

test('public status exposes connected only for a consistent confirmed state', () => {
  assert.equal(M.publicStatus({ state: 'connected', connected: true }).connected, true)
  assert.equal(M.publicStatus({ state: 'connected', connected: false }).connected, false)

  for (const state of [
    'checking', 'disconnected', 'connecting', 'missing-client', 'daemon-down',
    'unregistered', 'no-network', 'error', 'unknown', 'future-state'
  ]) assert.equal(M.publicStatus({ state, connected: true }).connected, false, state)
})

test('capabilities require a consistent settled connection state', () => {
  const base = {
    connected: false,
    registered: true,
    registrationKnown: true,
    settingsKnown: true,
    managed: false,
    locked: false,
    busy: false
  }

  assert.deepEqual(M.capabilities({ ...base, state: 'disconnected' }), {
    canConnect: true,
    canDisconnect: false,
    canConfigure: true,
    canRegister: false,
    canStartDaemon: false
  })
  assert.deepEqual(M.capabilities({ ...base, state: 'connected', connected: true }), {
    canConnect: false,
    canDisconnect: true,
    canConfigure: true,
    canRegister: false,
    canStartDaemon: false
  })

  for (const state of ['checking', 'connecting', 'no-network', 'error', 'unknown']) {
    const capabilities = M.capabilities({ ...base, state })
    assert.equal(capabilities.canConnect, false, `${state} connect`)
    assert.equal(capabilities.canDisconnect, false, `${state} disconnect`)
    assert.equal(capabilities.canConfigure, false, `${state} configure`)
  }

  const inconsistentConnected = M.capabilities({ ...base, state: 'connected', connected: false })
  assert.equal(inconsistentConnected.canConnect, false)
  assert.equal(inconsistentConnected.canDisconnect, false)
  const inconsistentDisconnected = M.capabilities({ ...base, state: 'disconnected', connected: true })
  assert.equal(inconsistentDisconnected.canConnect, false)
  assert.equal(inconsistentDisconnected.canDisconnect, false)
})
