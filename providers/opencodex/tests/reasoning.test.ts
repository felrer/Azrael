import { expect, test } from 'bun:test';
import { normalizeOpenRouterReasoning, OPENROUTER_EFFORTS, validateOpenRouterReasoning } from '../reasoning.ts';

test('GLM 5.3 and flash/batch share verified stages, not adjacent versions', () => {
  for (const id of ['z-ai/glm-5.3', 'z-ai/glm-5.3:batch', 'z-ai/glm-5.3-flash', 'z-ai/glm-5.3-flash:batch']) {
    expect(normalizeOpenRouterReasoning({ id })).toEqual({ supported_efforts: ['low', 'high', 'max'], default_effort: 'max', mandatory: true, default_enabled: true });
  }
  for (const id of ['z-ai/glm-5.2', 'z-ai/glm-5', 'z-ai/glm-4.7', 'z-ai/glm-5.3-future', '~z-ai/glm-latest']) {
    expect(normalizeOpenRouterReasoning({ id }).supported_efforts).toEqual([]);
  }
});

test('API stages and defaults override fallback and mandatory excludes none', () => {
  expect(normalizeOpenRouterReasoning({ id: 'z-ai/glm-5.3', reasoning: { supported_efforts: ['high', 'none', 'low'], mandatory: false, default_effort: 'low' } }))
    .toEqual({ supported_efforts: ['none', 'low', 'high'], default_effort: 'low', mandatory: false, default_enabled: true });
  expect(normalizeOpenRouterReasoning({ id: 'vendor/model', reasoning: { supported_efforts: null, mandatory: true, default_effort: 'max' } }))
    .toEqual({ supported_efforts: OPENROUTER_EFFORTS.filter(e => e !== 'none'), default_effort: 'max', mandatory: true });
  expect(normalizeOpenRouterReasoning({ id: 'z-ai/glm-5.3', reasoning: { supported_efforts: [] } }).supported_efforts).toEqual([]);
});

test('malformed data never manufactures stages; missing defaults remain automatic', () => {
  for (const reasoning of [null, [], { supported_efforts: ['ultra'] }, { supported_efforts: ['high', 'high'] }, { mandatory: 'yes' }, { mandatory: true, default_enabled: false, supported_efforts: ['high'] }]) {
    expect(normalizeOpenRouterReasoning({ id: 'z-ai/glm-5.3', reasoning }).supported_efforts).toEqual([]);
  }
  expect(normalizeOpenRouterReasoning({ id: 'vendor/model', reasoning: { supported_efforts: ['low', 'high'], default_effort: 'medium' } }).default_effort).toBeUndefined();
  expect(normalizeOpenRouterReasoning({ id: 'vendor/model', reasoning: { supported_efforts: ['none', 'high'], default_enabled: false, default_effort: 'high' } }).default_effort).toBe('none');
  expect(normalizeOpenRouterReasoning({ id: 'vendor/model', reasoning: { supported_efforts: ['low', 'high'], default_enabled: false, default_effort: 'high' } }).default_effort).toBeUndefined();
});

test('cached canonical metadata rejects unsupported stages/defaults and forbidden disable', () => {
  for (const value of [undefined, { supported_efforts: ['ultra'], mandatory: false }, { supported_efforts: ['none'], mandatory: true }, { supported_efforts: ['low', 'low'], mandatory: false }, { supported_efforts: ['low'], default_effort: 'high', mandatory: false }]) {
    expect(validateOpenRouterReasoning(value)).toBeFalse();
  }
  expect(validateOpenRouterReasoning(normalizeOpenRouterReasoning({ id: 'z-ai/glm-5.3' }))).toBeTrue();
});
