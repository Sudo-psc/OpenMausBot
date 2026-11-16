import assert from "node:assert/strict";
import test from "node:test";
import { createSurroundings, frontApp } from "./island-surroundings.mjs";

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
  assert.deepEqual(await describe(), { windows: ["Inbox", "Janela 0", "Janela 1", "Janela 2", "Janela 3", "Janela 4"] });
  assert.deepEqual(options, { types: ["window"], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
  const failing = createSurroundings({ platform: "darwin", execFile: lsappinfo({ front: "ASN:0x0-0x2:", info: '"LSDisplayName"="Notas"' }),
    desktopCapturer: { getSources: async () => { throw new Error("denied"); } } });
  assert.deepEqual(await failing(), { app: "Notas", windows: [] });
});
