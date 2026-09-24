# Custom numeric dice

Systems may add a `dice3d` declaration to `system.json`. It is data; it contains
no code, callbacks, shaders, or external asset URLs. Custom dice are usable from
the room's **Free roll → System die** selector even when 3D animation is disabled.

```json
{
  "dice3d": {
    "version": 1,
    "dice": [
      {
        "id": "fate",
        "name": "Fate die",
        "shape": 6,
        "values": [-1, -1, 0, 0, 1, 1]
      }
    ]
  }
}
```

`shape` is one of 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, or 30. `values`
has exactly that many integers between -999 and 999. Each entry is equally likely;
repeated values occur with proportionally greater probability. The server selects
the face index, then reads its value. The animation preserves that face identity.
The odd barrels repeat the value sequence on their additional physical facets.

Ids are lowercase, begin with a letter, and contain at most 32 letters, digits,
or hyphens. Ids must be unique within a system. At runtime they are qualified as
`<system-id>:<die-id>`; a room may only roll dice its own system declares.

The roll endpoint accepts `{ "customDie": "fate", "count": 4 }` alongside its
usual `private` or `invisible` choice. A custom roll cannot also declare a standard
expression, save, skill check, or attack. Standard expression syntax, table
expressions, and character-creation declarations are unchanged; this release
does not introduce custom-die expression syntax or symbol resolution rules.

## Authored shapes

For a new shape, replace `shape` with `geometry` and `resultFaces`:

```json
{
  "id": "custom-cube",
  "name": "Custom cube",
  "geometry": {
    "vertices": [
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1]
    ],
    "faces": [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7]
    ]
  },
  "resultFaces": [0, 1, 2, 3, 4, 5],
  "values": [1, 2, 3, 4, 5, 6]
}
```

Vertices are finite `[x,y,z]` coordinates from -10 to 10. A face lists vertex
indices in outward, counterclockwise winding order. The geometry must be a closed,
connected convex solid with planar, nondegenerate convex faces. Every selected
result face must have a parallel opposite face for a stable face-up landing.
The built-in tetrahedron handles its special tip-reading convention separately.

`resultFaces` maps each value to a distinct geometric face index. Unselected faces
are unnumbered and never selected as outcomes. Number placement and upright
landing orientation are derived from each polygon; an author does not supply
executable placement logic. The renderer centers and normalizes the geometry.

Limits: 24 definitions per system, 4–64 vertices and faces per authored shape,
3–32 vertices per face, and 2–64 outcome mappings. These bound imported rendering
data rather than changing a game's roll rules.

Run `npm run systems:validate -- <system-repository>` before release. Invalid
definitions are refused before installation replaces existing content. The
published JSON Schema covers structure; the install validator additionally checks
geometry and mappings. Inline geometry follows the normal atomic installation,
cache invalidation, bundle, and repository export paths. Each live roll includes
a validated definition snapshot, so replacing a system cannot change the faces
of a throw already in flight. As with other system updates, bump the system's
`devilsystem.json` version when publishing the new declaration.

Body material and labels are separate. Raster skins and texture assets are Phase 2
and should not be added as arbitrary files alongside this declaration.
