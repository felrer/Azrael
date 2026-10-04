import assert from 'node:assert/strict';

// Native acceptance only: the fixture never opens a thread, starts a turn,
// calls autoWindowTick, or redeems a usage credit.
export async function runAccountControls(context) {
  const { first, second, accounts, startPair, stopPair, azrael, waitForState,
    expectRpcError, stateDirectory, setCurrentPair, checks } = context;
  const ids = [first.profileId, second.profileId];
  assert.notEqual(ids[0], ids[1], 'Synthetic A/B profiles must be distinct');
  let pair = await startPair('account controls');
  setCurrentPair(pair);
  assert(pair.bridge && pair.management !== pair.stdio, 'Account controls require the real management bridge');
  await waitForState(pair.management, state => !state.isSwitching && state.activeProfileId === second.profileId, 'controls restore B');

  const validate = response => {
    assert.equal(response.state.codexHome, stateDirectory, 'Control response home mismatch');
    assert.equal(typeof response.state.instanceId, 'string');
    assert(response.state.instanceId.length > 0, 'Missing engine instance identity');
    assert.equal(response.state.profiles.length, 2, 'Unexpected profiles in controls fixture');
    for (const [index, id] of ids.entries()) {
      const profile = response.state.profiles.find(item => item.id === id);
      assert(profile, 'Missing captured profile');
      assert.equal(profile.workspaceAccountId, accounts[index].accountId, 'Profile workspace mismatch');
      assert.equal(profile.userId, accounts[index].userId, 'Profile user mismatch');
      assert.equal(typeof profile.autoSwitchAllowed, 'boolean', 'Missing explicit switch permission');
    }
    return response;
  };
  const status = async peer => {
    const response = validate(await azrael(peer, 'autoWindowStatus'));
    assert(Array.isArray(response.autoWindows), 'Status must expose automatic window schedules');
    assert.equal(response.autoWindows.length, 2, 'Paid defaults must exist without expanded usage UI');
    const owners = new Set();
    for (const [index, id] of ids.entries()) {
      const schedule = response.autoWindows.find(item => item.profileId === id);
      assert(schedule, 'Schedule profile identity mismatch');
      assert.equal(schedule.workspaceAccountId, accounts[index].accountId, 'Schedule workspace mismatch');
      assert.equal(schedule.userId, accounts[index].userId, 'Schedule user mismatch');
      assert.equal(typeof schedule.enabled, 'boolean', 'Schedule enabled must be explicit');
      const owner = JSON.stringify([schedule.workspaceAccountId, schedule.userId]);
      assert(!owners.has(owner), 'Duplicate account schedule owner');
      owners.add(owner);
      if (!schedule.enabled) assert.equal(schedule.status, 'disabled', 'OFF schedule must be disabled');
    }
    return response;
  };
  const permissions = response => ids.map(id => response.state.profiles.find(item => item.id === id).autoSwitchAllowed);
  const windows = response => ids.map(id => response.autoWindows.find(item => item.profileId === id).enabled);
  const snapshot = response => ({ activeProfileId: response.state.activeProfileId,
    pendingProfileId: response.state.pendingProfileId, isSwitching: response.state.isSwitching,
    permissions: permissions(response), windows: response.autoWindows });
  const readback = async (expectedPermissions, expectedWindows) => {
    for (const peer of [pair.management, pair.stdio]) {
      const listed = validate(await azrael(peer, 'list'));
      assert.deepEqual(permissions(listed), expectedPermissions, 'Switch permission readback mismatch');
      const response = await status(peer);
      assert.equal(response.state.instanceId, listed.state.instanceId, 'Response instance identity mismatch');
      assert.deepEqual(permissions(response), expectedPermissions, 'Status permission readback mismatch');
      assert.deepEqual(windows(response), expectedWindows, 'Timer enabled readback mismatch');
      assert.equal(response.state.activeProfileId, second.profileId, 'Control changed active profile');
    }
  };
  const toggle = async (action, index, enabled) => {
    const response = validate(await azrael(pair.management, action, ids[index]));
    if (action.startsWith('autoSwitch')) {
      assert.equal(permissions(response)[index], enabled, 'Switch mutation response mismatch');
    } else {
      assert(Array.isArray(response.autoWindows), 'Timer mutation must return schedules');
      const schedule = response.autoWindows.find(item => item.profileId === ids[index]);
      assert(schedule, 'Timer mutation returned wrong profile identity');
      assert.equal(schedule.workspaceAccountId, accounts[index].accountId);
      assert.equal(schedule.userId, accounts[index].userId);
      assert.equal(schedule.enabled, enabled, 'Timer mutation response mismatch');
    }
  };
  const initial = await status(pair.management);
  assert.deepEqual(windows(initial), [true, true], 'Fresh paid accounts must default to timer ON');
  checks.push('paid timer defaults exposed by native status without expanded UI');
  await toggle('autoWindowDisable', 0, false);
  await toggle('autoWindowDisable', 1, false);
  checks.push('management timer OFF responses identify each synthetic account before any tick');

  await toggle('autoSwitchDisable', 0, false);
  await toggle('autoSwitchDisable', 1, false);
  await readback([false, false], [false, false]);
  await toggle('autoSwitchEnable', 1, true);
  await toggle('autoWindowEnable', 1, true);
  await readback([false, true], [false, true]);
  checks.push('management switch and timer OFF/ON mutations agree with native and bridge readback');

  const unknownId = ['f'.repeat(32), 'e'.repeat(32)].find(id => !ids.includes(id));
  for (const action of ['autoSwitchEnable', 'autoSwitchDisable', 'autoWindowEnable', 'autoWindowDisable']) {
    for (const invalidId of [undefined, unknownId]) {
      const before = snapshot(await status(pair.management));
      await expectRpcError(azrael(pair.management, action, invalidId), `${action} invalid profile`);
      assert.deepEqual(snapshot(await status(pair.management)), before, `${action} rejection changed valid state`);
      await readback([false, true], [false, true]);
    }
  }
  checks.push('missing and unknown mutation profiles reject without changing permissions schedules or selection');

  const restart = async label => {
    const previousInstance = (await status(pair.management)).state.instanceId;
    await stopPair(pair);
    pair = await startPair(label);
    setCurrentPair(pair);
    assert(pair.bridge && pair.management !== pair.stdio, 'Restart must use real management bridge');
    const restored = await waitForState(pair.management, state => !state.isSwitching && state.activeProfileId === second.profileId, label);
    assert.notEqual(restored.instanceId, previousInstance, 'Full restart retained engine instance identity');
  };
  await restart('controls OFF/ON restart');
  await readback([false, true], [false, true]);
  checks.push('full engine and bridge restart preserves manual timer OFF and switch OFF alongside ON choices');
  await toggle('autoSwitchEnable', 0, true);
  await toggle('autoSwitchDisable', 1, false);
  await toggle('autoWindowDisable', 1, false);
  await readback([true, false], [false, false]);
  await restart('controls reversed switch restart');
  await readback([true, false], [false, false]);
  checks.push('second full restart preserves reversed switch permissions and both manual timer OFF choices');
  await stopPair(pair);
}
