import { main } from "./map-media";

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
