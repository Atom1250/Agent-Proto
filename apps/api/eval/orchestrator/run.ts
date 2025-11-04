import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import type { SlotUpdate } from '@agent-proto/shared';

import { normalizeStructuredOutput } from '../../src/lib/structuredOutput.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURE_DIR = path.join(__dirname, 'fixtures');

type Fixture = {
  id: string;
  description?: string;
  utterance: string;
  goldenStructuredOutput: unknown;
  expected: {
    slotUpdates: SlotUpdate[];
    missingRequiredSlots?: string[];
  };
};

type EvalResult = {
  fixture: Fixture;
  passed: boolean;
  messages: string[];
};

async function readFixture(filePath: string): Promise<Fixture> {
  const buffer = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(buffer) as Fixture;
  return parsed;
}

async function loadFixtures(): Promise<Fixture[]> {
  const entries = await fs.readdir(FIXTURE_DIR);
  const jsonFiles = entries.filter((entry) => entry.endsWith('.json')).sort();
  const fixtures: Fixture[] = [];
  for (const file of jsonFiles) {
    fixtures.push(await readFixture(path.join(FIXTURE_DIR, file)));
  }
  return fixtures;
}

function slotKey(value: SlotUpdate): string {
  return value.slotKey;
}

function normalizeSlotUpdates(values: SlotUpdate[]): SlotUpdate[] {
  return [...values].sort((a, b) => slotKey(a).localeCompare(slotKey(b)));
}

function normalizeMissing(values: string[] | undefined): string[] {
  return [...(values ?? [])].sort((a, b) => a.localeCompare(b));
}

function compareSlotUpdates(actual: SlotUpdate[], expected: SlotUpdate[]): string[] {
  const issues: string[] = [];
  const normalizedActual = normalizeSlotUpdates(actual);
  const normalizedExpected = normalizeSlotUpdates(expected);

  if (normalizedActual.length !== normalizedExpected.length) {
    issues.push(`expected ${normalizedExpected.length} slot updates but received ${normalizedActual.length}`);
  }

  const len = Math.max(normalizedActual.length, normalizedExpected.length);
  for (let index = 0; index < len; index += 1) {
    const actualEntry = normalizedActual[index];
    const expectedEntry = normalizedExpected[index];
    if (!actualEntry || !expectedEntry) {
      continue;
    }
    if (actualEntry.slotKey !== expectedEntry.slotKey) {
      issues.push(`slot key mismatch at position ${index}: expected "${expectedEntry.slotKey}" but received "${actualEntry.slotKey}"`);
    }
    const valuesMatch =
      actualEntry.value === expectedEntry.value ||
      (typeof actualEntry.value === 'number' && typeof expectedEntry.value === 'number' &&
        Number.isNaN(actualEntry.value) && Number.isNaN(expectedEntry.value));
    if (!valuesMatch) {
      issues.push(
        `value mismatch for slot "${expectedEntry.slotKey}": expected ${JSON.stringify(
          expectedEntry.value,
        )} but received ${JSON.stringify(actualEntry.value)}`,
      );
    }
  }

  return issues;
}

function compareMissingSlots(actual: string[], expected: string[]): string[] {
  const issues: string[] = [];
  const normalizedActual = normalizeMissing(actual);
  const normalizedExpected = normalizeMissing(expected);

  if (normalizedActual.length !== normalizedExpected.length) {
    issues.push(
      `expected ${normalizedExpected.length} missing required slots but received ${normalizedActual.length}`,
    );
  }

  const len = Math.max(normalizedActual.length, normalizedExpected.length);
  for (let index = 0; index < len; index += 1) {
    const actualEntry = normalizedActual[index];
    const expectedEntry = normalizedExpected[index];
    if (!actualEntry || !expectedEntry) {
      continue;
    }
    if (actualEntry !== expectedEntry) {
      issues.push(
        `missing slot mismatch at position ${index}: expected "${expectedEntry}" but received "${actualEntry}"`,
      );
    }
  }

  return issues;
}

function evaluateFixture(fixture: Fixture): EvalResult {
  const { slotUpdates, missingRequiredSlots } = normalizeStructuredOutput(fixture.goldenStructuredOutput);
  const expectedMissing = fixture.expected.missingRequiredSlots ?? [];

  const slotIssues = compareSlotUpdates(slotUpdates, fixture.expected.slotUpdates);
  const missingIssues = compareMissingSlots(missingRequiredSlots, expectedMissing);

  const issues = [...slotIssues, ...missingIssues];

  return {
    fixture,
    passed: issues.length === 0,
    messages: issues,
  };
}

async function runOffline(fixtures: Fixture[]): Promise<EvalResult[]> {
  return fixtures.map((fixture) => evaluateFixture(fixture));
}

type OnlineResult = {
  fixture: Fixture;
  passed: boolean;
  messages: string[];
};

async function runOnline(fixtures: Fixture[]): Promise<void> {
  const wantsOnline = process.argv.includes('--online');
  if (!wantsOnline) {
    console.log('Online verification not requested (pass --online to enable).');
    return;
  }

  const endpoint = process.env.ORCHESTRATOR_EVAL_URL;
  if (!endpoint) {
    console.log('Skipping online verification: ORCHESTRATOR_EVAL_URL is not set.');
    return;
  }

  console.log(`\nRunning online verification against ${endpoint}`);

  const results: OnlineResult[] = [];

  for (const fixture of fixtures) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ utterance: fixture.utterance }),
      });

      if (!response.ok) {
        results.push({
          fixture,
          passed: false,
          messages: [`endpoint responded with status ${response.status}`],
        });
        continue;
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const normalized = normalizeStructuredOutput(
        payload.structuredOutput ?? payload.structured_output ?? payload,
      );

      const actualKeys = new Set(normalizeSlotUpdates(normalized.slotUpdates).map((entry) => entry.slotKey));
      const expectedKeys = new Set(normalizeSlotUpdates(fixture.expected.slotUpdates).map((entry) => entry.slotKey));
      const missingKeys = Array.from(expectedKeys).filter((key) => !actualKeys.has(key));

      const actualMissing = new Set(normalizeMissing(normalized.missingRequiredSlots));
      const expectedMissing = new Set(normalizeMissing(fixture.expected.missingRequiredSlots));
      const missingMissingSlots = Array.from(expectedMissing).filter((key) => !actualMissing.has(key));

      const issues: string[] = [];
      if (missingKeys.length > 0) {
        issues.push(`missing slot updates for keys: ${missingKeys.join(', ')}`);
      }
      if (missingMissingSlots.length > 0) {
        issues.push(`missing required slot hints: ${missingMissingSlots.join(', ')}`);
      }

      results.push({ fixture, passed: issues.length === 0, messages: issues });
    } catch (error) {
      results.push({
        fixture,
        passed: false,
        messages: [`online check failed: ${(error as Error).message}`],
      });
    }
  }

  results.forEach((result) => {
    const status = result.passed ? 'PASS' : 'FAIL';
    console.log(`\n[online ${status}] ${result.fixture.id}`);
    if (!result.passed) {
      result.messages.forEach((message) => {
        console.log(`  - ${message}`);
      });
    }
  });

  const passed = results.filter((result) => result.passed).length;
  console.log(`\nOnline fixtures: ${passed}/${results.length} passed.`);
}

function printResult(result: EvalResult) {
  const status = result.passed ? 'PASS' : 'FAIL';
  console.log(`\n[${status}] ${result.fixture.id}`);
  if (result.fixture.description) {
    console.log(`  ${result.fixture.description}`);
  }
  if (!result.passed) {
    result.messages.forEach((message) => {
      console.log(`  - ${message}`);
    });
  }
}

async function main() {
  const fixtures = await loadFixtures();
  if (fixtures.length === 0) {
    console.log('No orchestrator fixtures found.');
    return;
  }

  console.log(`Loaded ${fixtures.length} orchestrator fixtures.`);

  const offlineResults = await runOffline(fixtures);
  offlineResults.forEach(printResult);

  const passedCount = offlineResults.filter((result) => result.passed).length;
  console.log(`\nOffline fixtures: ${passedCount}/${fixtures.length} passed.`);

  await runOnline(fixtures);

  if (passedCount !== fixtures.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Eval harness failed:', error);
  process.exitCode = 1;
});
