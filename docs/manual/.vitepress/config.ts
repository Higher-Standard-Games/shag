import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'SHAG Engine',
  description: 'TypeScript/WebGL game engine with Quake 3/Warsow compatibility',
  
  // Use docs/manual as the source
  srcDir: '.',
  outDir: '../../dist-docs',

  // localhost URLs are dev-server instructions, not links to verify
  ignoreDeadLinks: [/^https?:\/\/localhost/],
  
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { href: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Share+Tech+Mono&display=swap', rel: 'stylesheet' }]
  ],

  themeConfig: {
    logo: '/logo.png',
    
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Getting Started', link: '/getting-started/' },
      { text: 'Tutorials', link: '/tutorials/' },
      { text: 'Guides', link: '/guides/' },
      { text: 'API', link: '/api/' }
    ],

    sidebar: {
      '/': [
        {
          text: 'Introduction',
          items: [
            { text: 'What is SHAG Engine?', link: '/introduction/' },
            { text: 'Features', link: '/introduction/features' }
          ]
        },
        {
          text: 'Getting Started',
          items: [
            { text: 'Installation', link: '/getting-started/' },
            { text: 'Project Structure', link: '/getting-started/project-structure' },
            { text: 'Building', link: '/getting-started/building' }
          ]
        },
        {
          text: 'Tutorials',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/tutorials/' },
            {
              text: 'Beginner',
              collapsed: true,
              items: [
                { text: 'First Map Load', link: '/tutorials/beginner/first-map-load' },
                { text: 'Camera Navigation', link: '/tutorials/beginner/camera-navigation' },
                { text: 'Using the Console', link: '/tutorials/beginner/using-console' },
                { text: 'Render Variables', link: '/tutorials/beginner/render-variables' }
              ]
            },
            {
              text: 'Intermediate',
              collapsed: true,
              items: [
                { text: 'Map Viewer', link: '/tutorials/intermediate/map-viewer' },
                { text: 'FPS Skeleton', link: '/tutorials/intermediate/fps-skeleton' },
                { text: 'Isometric Game', link: '/tutorials/intermediate/isometric-game' },
                { text: 'Sidescroller', link: '/tutorials/intermediate/sidescroller' },
                { text: 'Custom Commands', link: '/tutorials/intermediate/custom-commands' },
                { text: 'PK3 Mods', link: '/tutorials/intermediate/pk3-mods' }
              ]
            },
            {
              text: 'Advanced',
              collapsed: true,
              items: [
                { text: 'Custom Camera', link: '/tutorials/advanced/custom-camera' },
                { text: 'Custom Shaders', link: '/tutorials/advanced/custom-shaders' },
                { text: 'Entity System', link: '/tutorials/advanced/entity-system' },
                { text: 'Headless Testing', link: '/tutorials/advanced/headless-testing' },
                { text: 'Performance', link: '/tutorials/advanced/performance' }
              ]
            },
            {
              text: 'Recipes',
              collapsed: true,
              items: [
                { text: 'Change Skybox', link: '/tutorials/recipes/change-skybox' },
                { text: 'Toggle Wireframe', link: '/tutorials/recipes/toggle-wireframe' },
                { text: 'Get Spawn Points', link: '/tutorials/recipes/get-spawn-points' },
                { text: 'Extract Entities', link: '/tutorials/recipes/extract-entities' },
                { text: 'Debug Shader', link: '/tutorials/recipes/debug-shader' },
                { text: 'Export Settings', link: '/tutorials/recipes/export-settings' }
              ]
            },
            { text: 'Quick Recipes', link: '/tutorials/quick-recipes' }
          ]
        },
        {
          text: 'Guides',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/guides/' },
            {
              text: 'Core Systems',
              collapsed: false,
              items: [
                { text: 'Configuration', link: '/guides/configuration' },
                { text: 'BSP System', link: '/guides/bsp-system' },
                { text: 'Shader System', link: '/guides/shader-system' },
                { text: 'PK3 Filesystem', link: '/guides/pk3-filesystem' },
                { text: 'Raw .map System', link: '/guides/raw-map-system' },
                { text: 'Camera System', link: '/guides/camera-system' },
                { text: 'Physics System', link: '/guides/physics-system' },
                { text: 'Movement System', link: '/guides/movement-system' },
                { text: 'Pickup System', link: '/guides/pickup-system' },
                { text: 'Weapon System', link: '/guides/weapon-system' },
                { text: 'Model Loading', link: '/guides/model-loading' }
              ]
            },
            {
              text: 'Rendering',
              collapsed: true,
              items: [
                { text: 'Render Variables', link: '/guides/render-variables' },
                { text: 'Lighting System', link: '/guides/lighting-system' },
                { text: 'Skybox System', link: '/guides/skybox-system' },
                { text: 'Viewport Effects', link: '/guides/viewport-effects' }
              ]
            },
            {
              text: 'Runtime',
              collapsed: true,
              items: [
                { text: 'Console System', link: '/guides/console-system' },
                { text: 'Command Reference', link: '/guides/command-reference' },
                { text: 'Cvar System', link: '/guides/cvar-system' },
                { text: 'Map Launching', link: '/guides/map-launching' },
                { text: 'Service Registries', link: '/guides/service-registries' }
              ]
            },
            {
              text: 'Multiplayer',
              collapsed: true,
              items: [
                { text: 'Networking System', link: '/guides/networking' }
              ]
            },
            { text: 'Headless Mode', link: '/guides/headless-mode' }
          ]
        },
        {
          text: 'Tools',
          items: [
            { text: 'Overview', link: '/tools/' },
            { text: 'Headless Game', link: '/tools/headless-game' },
            { text: 'Headless BSP', link: '/tools/headless-bsp' },
            { text: 'Network Server', link: '/tools/network-server' },
            { text: 'Network Client', link: '/tools/network-client' },
            { text: 'Agent Orchestration', link: '/tools/agent-orchestration' }
          ]
        },
        {
          text: 'Deployment',
          items: [
            { text: 'Overview', link: '/deployment/' },
            { text: 'Web', link: '/deployment/web' },
            { text: 'Mobile', link: '/deployment/mobile' },
            { text: 'Desktop', link: '/deployment/desktop' }
          ]
        },
        {
          text: 'FAQ',
          link: '/faq/'
        },
        {
          text: 'Contributing',
          link: '/contributing/'
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/user/shag-engine' }
    ],

    search: {
      provider: 'local'
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-present'
    }
  }
})
