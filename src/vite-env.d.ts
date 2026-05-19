/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOBBY_URL?: string;
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
