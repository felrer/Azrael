import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

const input = resolve(process.argv[2]);
const report = JSON.parse(await readFile(input, 'utf8'));
const mib = value => value == null ? null : Math.round(value / 1024 ** 2 * 100) / 100;
const rows = text => text.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
const modes = [];
for (const mode of report.modes) {
  let continuous = [];
  if (mode.continuousSamples) continuous = rows(await readFile(join(dirname(input), basename(mode.continuousSamples)), 'utf8'));
  const peak = continuous.reduce((a, b) => !a || b.privateBytes > a.privateBytes ? b : a, null);
  const driverPeak = continuous.reduce((a, b) => !a || b.driverRssBytes > a.driverRssBytes ? b : a, null);
  const checkpoints = mode.checkpoints.map((c, i, all) => {
    const end = new Date(c.samples.at(-1).atUtc).getTime();
    const start = i ? new Date(all[i - 1].samples.at(-1).atUtc).getTime() : -Infinity;
    const interval = continuous.filter(s => new Date(s.atUtc).getTime() > start && new Date(s.atUtc).getTime() <= end);
    return { label: c.label, loadedCount: c.loadedCount, privateMiB: mib(c.medianPrivateBytes),
      workingSetMiB: mib(c.medianWorkingSetBytes), driverRssMiB: mib(c.medianDriverRssBytes),
      intervalNativePeakMiB: interval.length ? mib(Math.max(...interval.map(s => s.privateBytes))) : null,
      intervalDriverPeakMiB: interval.length ? mib(Math.max(...interval.map(s => s.driverRssBytes))) : null };
  });
  modes.push({ name: mode.name, status: mode.status, stopped: mode.stopped, loadedZeroAfter90s: mode.loadedZeroAfter90s,
    sampleCount: continuous.length, observedNativePeakMiB: mib(peak?.privateBytes), observedNativePeakUtc: peak?.atUtc,
    observedDriverRssPeakMiB: mib(driverPeak?.driverRssBytes),
    minFreeMiB: continuous.length ? mib(Math.min(...continuous.map(s => s.freeBytes))) : null,
    maxObservationMs: continuous.length ? Math.max(...continuous.map(s => s.elapsedMs)) : null,
    checkpoints, pagedReads: mode.pagedReads, fullReads: mode.reads, firstPage: mode.firstPage,
    beforeProjection: mode.beforeProjection, afterProjection: mode.afterProjection, rpc: mode.rpc });
}
const output = { status: report.status, failure: report.failure, producerStopped: report.producerStopped,
  startedUtc: report.startedUtc, endedUtc: report.endedUtc, snapshot: report.snapshot, modes,
  interpretation: ['Private Bytes is committed process memory; Working Set includes shared resident pages.',
    'Peaks are observed samples, not guaranteed maxima. Checkpoint interval includes all operations since previous checkpoint.',
    'Client discards pages and forces its own GC at checkpoints; no native GC or heap attribution is available.',
    'B/C share a copied database; stale indexes rebuilt in B remain rebuilt in C.'] };
const target = join(dirname(input), 'summary.json');
await writeFile(target, JSON.stringify(output, null, 2));
console.log(JSON.stringify({ status: output.status, failure: output.failure, producerStopped: output.producerStopped,
  threads: output.snapshot?.threads.map(t => ({ id: t.id, rolloutMiB: mib(t.rolloutBytes), turns: t.turnCount, items: t.itemCount, itemMiB: mib(t.itemBytes), projectionVersion: t.projection.projection_version,
    contextSuffixMiB: mib(t.rollout.rawBytesFromLatestUsableCompaction), types: t.byItemType })),
  modes: modes.map(m => ({ ...m, beforeProjection: undefined, afterProjection: undefined, rpc: undefined, pagedReads: undefined, fullReads: undefined })), summary: target }));
