import assert from "node:assert/strict";
import test from "node:test";
import { createFrontApp, createSurroundings, frontApp } from "./island-surroundings.mjs";

const lsappinfo = replies => (file, args, _options, done) => {
  assert.equal(file, "/usr/bin/lsappinfo");
  const reply = replies[args[0]];
  if (reply instanceof Error) done(reply, ""); else done(null, reply);
};

test("the app in front is read on a Mac without any privacy permission, and nowhere else", async () => {
  const asked = [];
  const execFile = (file, args, options, done) => { asked.push(args); lsappinfo({ front: "ASN:0x0-0x1b01b:\n", info: '"LSDisplayName"="Safari"\n' })(file, args, options, done); };
  assert.equal(await frontApp({ platform: "darwin", execFile }), "Safari");
  assert.deepEqual(asked, [["front"], ["info", "-only", "name", "ASN:0x0-0x1b01b:"]]);
  assert.equal(await frontApp({ platform: "win32", execFile: () => assert.fail("no such command") }), null);
  assert.equal(await frontApp({ platform: "darwin", execFile: lsappinfo({ front: "[ NULL ]\n" }) }), null);
  assert.equal(await frontApp({ platform: "darwin", execFile: lsappinfo({ front: new Error("gone") }) }), null);
  assert.equal(await frontApp({ platform: "darwin", execFile: lsappinfo({ front: "ASN:0x0-0x2:", info: "unexpected" }) }), null);
  assert.equal(await frontApp({ platform: "darwin", execFile: () => { throw new Error("spawn"); } }), null);
});

test("open windows are listed without pictures, without this app's overlays, and bounded", async () => {
  let options;
  const names = ["Inbox", "", "MausBot island", "Inbox", ...Array.from({ length: 9 }, (_, index) => `Janela ${index}`)];
  const describe = createSurroundings({ platform: "linux", ignore: () => ["MausBot island"],
    desktopCapturer: { getSources: async input => { options = input; return names.map(name => ({ name })); } } });
  assert.deepEqual(await describe(), { windows: ["Inbox", "Janela 0", "Janela 1", "Janela 2", "Janela 3", "Janela 4"], sensitive: false });
  assert.deepEqual(options, { types: ["window"], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
  const failing = createSurroundings({ platform: "darwin", execFile: lsappinfo({ front: "ASN:0x0-0x2:", info: '"LSDisplayName"="Notas"' }),
    desktopCapturer: { getSources: async () => { throw new Error("denied"); } } });
  assert.deepEqual(await failing(), { app: "Notas", windows: [], sensitive: false });
});

test("each frame reads only the app, and the app's name is asked again only when it changes", async () => {
  let spawned = [], serial = "ASN:0x0-0x1:", name = "Safari", enumerated = 0;
  const execFile = (file, args, _options, done) => { spawned.push(args[0]); done(null, args[0] === "front" ? serial : `"LSDisplayName"="${name}"`); };
  const describe = createSurroundings({ platform: "darwin", execFile, desktopCapturer: { getSources: async () => { enumerated += 1; return []; } } });
  for (let frame = 0; frame < 3; frame += 1) assert.deepEqual(await describe({ windows: false }), { app: "Safari", windows: [], sensitive: false });
  assert.deepEqual(spawned, ["front", "info", "front", "front"]);
  assert.equal(enumerated, 0);
  serial = "ASN:0x0-0x2:"; name = "Notas";
  assert.equal((await describe({ windows: false })).app, "Notas");
  assert.deepEqual(spawned.slice(-2), ["front", "info"]);
  await describe();
  assert.equal(enumerated, 1);
  const front = createFrontApp({ platform: "darwin", execFile });
  assert.equal(await front(), "Notas");
});

test("a private app is flagged and never named, and private window titles are never listed", async () => {
  const execFile = (file, args, _options, done) => done(null, args[0] === "front" ? "ASN:0x0-0x3:" : '"LSDisplayName"="1Password 8"');
  const describe = createSurroundings({ platform: "darwin", execFile,
    desktopCapturer: { getSources: async () => ["Inbox", "Banco do Brasil - Extrato", "Minhas SENHAS", "Itaú", "Relatório"].map(name => ({ name })) } });
  assert.deepEqual(await describe(), { windows: ["Inbox", "Relatório"], sensitive: true });
});

test("a name that could not be read is tried again, so a private app is caught once the command recovers", async () => {
  let reads = 0;
  const execFile = (file, args, _options, done) => {
    if (args[0] === "front") return done(null, "ASN:0x0-0x9:");
    reads += 1;
    return reads === 1 ? done(new Error("timed out"), "") : done(null, '"LSDisplayName"="1Password 8"');
  };
  const describe = createSurroundings({ platform: "darwin", execFile, desktopCapturer: { getSources: async () => [] } });
  assert.deepEqual(await describe({ windows: false }), { windows: [], sensitive: false });
  assert.deepEqual(await describe({ windows: false }), { windows: [], sensitive: true });
  assert.equal(reads, 2);
  assert.deepEqual(await describe({ windows: false }), { windows: [], sensitive: true });
  assert.equal(reads, 2);
});
