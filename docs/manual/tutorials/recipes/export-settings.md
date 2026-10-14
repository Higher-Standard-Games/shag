# Recipe: export settings

## Console

```text
settings list
settings export
settings import
```

`settings list` shows every setting changed from its default. `settings export` copies those settings to the clipboard as console lines, and `settings import` applies them from the clipboard. The import reports how many lines it applied and lists any line it rejected, with the reason.

Related exports:

```text
cvarexport
render export
export all
```

`cvarexport` and `export all` also copy to the clipboard; `render export` prints the renderer configuration as command output. Clipboard access needs a secure context (HTTPS or localhost) and the browser's permission.

## Code

```ts
const cvarText = Cvar.exportConfig();
const { accepted, rejected } = Cvar.execConfig(cvarText);

const renderText = RenderVars.getInstance().exportConfig();
RenderVars.getInstance().importConfig(renderText);
```

Treat exported debug settings as local diagnostics, not as checked-in defaults, unless they have been reviewed.
