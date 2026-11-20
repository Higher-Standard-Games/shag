/// <reference types="vite/client" />
/// <reference types="@webgpu/types" />

interface ImportMetaEnv {
  readonly VITE_LOBBY_URL?: string;
  /** Base URL of the HTTP mirror pk3 packages are downloaded from when it has them (Pk3Mirror). */
  readonly VITE_PK3_MIRROR_URL?: string;
  /** Set in a build for a host we don't own (`itch`): the region is picked in the client (HostedBuild). */
  readonly VITE_HOSTED?: string;
  /** "1": the region picker also offers this machine's lobby and dev server. */
  readonly VITE_LOCAL_REGION?: string;
}

// CSS module imports with ?raw suffix
declare module "*.css?raw" {
  const content: string;
  export default content;
}

// Regular CSS module imports
declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}
