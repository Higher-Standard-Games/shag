import { MapStore } from "../engine/editor/server/MapStore";
import { resolveServerConfig } from "../engine/editor/server/ServerConfig";
import { createShaggedHttpServer } from "../engine/editor/server/ShaggedHttpServer";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: npm run shagged:server -- [--maps-root DIR] [--port N] [--ui-origin ORIGIN]");
  process.exit(0);
}

try {
  const config = resolveServerConfig(args);
  const store = new MapStore(config.mapsRoot);
  await store.init();
  const server = createShaggedHttpServer(store, config);
  server.listen(config.port, "127.0.0.1", () => {
    console.log(`SHAGGED map service: http://127.0.0.1:${config.port}`);
    console.log(`Maps root: ${config.mapsRoot}`);
    console.log("Save/Open ready; Compile and Playtest unavailable");
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
