/**
 * fair-play — review reports and counters, and record the sanctions a person
 * decides on. Safe beside a running lobby: it writes `fairplay.db`, and the
 * lobby reads bans at each login and closes banned connections within a minute.
 *
 * Nothing here decides on its own. Every sanction needs a reason, which the
 * player is shown with how to appeal (src/lobby/FairPlayStore.ts has the
 * retention rules).
 */
import fs from "node:fs";
import path from "node:path";
import { FairPlayStore, MAX_ADDRESS_BAN_MS, type SanctionKind } from "../lobby/FairPlayStore";

const DAY_MS = 24 * 60 * 60_000;
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const value = (flag: string) => {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
};
const usage = `Usage: npm run fair-play -- <command> --data-dir <dir> [options]

  reports                               open player reports, oldest first
  account <id>                          an account's sanctions, reports and per-match counters
  sanctions                             every sanction kept
  ban <id> --reason "<text>" [--days N] ban an account (no --days: until lifted)
  restrict <id> --reason "<text>" [--days N]
                                        keep an account out of public rooms and the queue
  lift <sanction id>                    end a sanction now
  close-report <report id>              mark a report reviewed
  ban-address <address> --reason "<text>" --days N
                                        refuse logins from an address (at most ${MAX_ADDRESS_BAN_MS / DAY_MS} days)
  lift-address <address>                end an address ban
  prune                                 apply the retention rules now

  --by <name>   who decided (kept with the sanction; default $USER)

The reason is shown to the player. Decide only after reviewing the evidence:
the counters are signals, not verdicts.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const [command, target] = args;
if (!command || args.includes("--help")) {
  console.log(usage);
  process.exit(0);
}
const dataDir = value("--data-dir");
if (!dataDir || dataDir.startsWith("--")) fail("An explicit --data-dir is required");
const dir = path.resolve(dataDir);
if (!fs.existsSync(dir)) fail(`No data directory at ${dir}`);
const store = FairPlayStore.open(dir);
const by = value("--by") ?? process.env.USER ?? "operator";
const days = value("--days");
const durationMs = days === undefined ? null : Number(days) * DAY_MS;
if (durationMs !== null && !(durationMs > 0)) fail("--days must be a positive number");
const accountId = () => {
  const id = Number(target);
  if (!Number.isSafeInteger(id) || id <= 0) fail("Give an account id");
  return id;
};
const reason = () => value("--reason") ?? fail('Give --reason "<text>": the player is shown it');
const print = (data: unknown) => console.log(JSON.stringify(data, null, 2));

try {
  switch (command) {
    case "reports":
      print(store.openReports());
      break;
    case "account": {
      const id = accountId();
      print({
        accountId: id,
        sanctions: store.sanctions().filter((s) => s.accountId === id),
        reports: store.reportsAbout(id),
        matches: store.signalsFor(id),
      });
      break;
    }
    case "sanctions":
      print(store.sanctions());
      break;
    case "ban":
    case "restrict": {
      const kind: SanctionKind = command === "ban" ? "ban" : "ranked";
      print(store.addSanction(accountId(), kind, reason(), durationMs, by));
      break;
    }
    case "lift":
      if (!store.liftSanction(Number(target))) fail("No sanction in force with that id");
      console.log(`Lifted sanction ${target}`);
      break;
    case "close-report":
      if (!store.closeReport(Number(target))) fail("No report with that id");
      console.log(`Closed report ${target}`);
      break;
    case "ban-address":
      if (!target) fail("Give an address");
      if (durationMs === null) fail("An address ban needs --days");
      store.banAddress(target, reason(), durationMs);
      console.log(`Address banned for ${days} days (kept as a keyed hash)`);
      break;
    case "lift-address":
      if (!target || !store.liftAddressBan(target)) fail("No ban on that address");
      console.log("Address ban lifted");
      break;
    case "prune":
      console.log(`Deleted ${store.prune()} rows past retention`);
      break;
    default:
      fail(usage);
  }
} catch (error) {
  fail((error as Error).message);
} finally {
  store.close();
}
