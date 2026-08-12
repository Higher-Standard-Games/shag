# Recipe: export settings

## Console

```text
cvarexport
render export
export all
```

`cvarexport` and `export all` copy to the browser clipboard. Clipboard access can fail when the page lacks permission or a secure context. `render export` returns renderer configuration as command output.

## Code

```ts
const cvarText = Cvar.exportConfig();
const renderText = RenderVars.getInstance().exportConfig();
```

Restore cvar text with:

```ts
Cvar.execConfig(cvarText);
```

There is no `Cvar.importConfig` method. Treat exported debug settings as local diagnostics rather than checked-in production defaults unless they have been reviewed.
