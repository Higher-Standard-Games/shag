# Recipe: inspect BSP entities

## Console

```text
bsp entities
bsp entities info_player_deathmatch details
bsp entities trigger details
```

## Code

```ts
const bsp = BspManager.getInstance().getBsp();
if (!bsp) throw new Error('Load a BSP first');

const lights = bsp.entities.filter((entity) => entity.classname === 'light');
const triggers = bsp.entities.filter((entity) => entity.classname.startsWith('trigger_'));

for (const entity of triggers) {
  console.log(entity.classname, entity.properties);
}
```

`bsp.entities` is already parsed into `{ classname, properties }` objects. There is no separate `EntityParser` step.

The presence of an entity in the BSP does not prove that the active game implements its behavior.
