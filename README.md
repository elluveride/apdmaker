# APD Maker

Draw custom airport diagrams that look like FAA charts (the *Airport Diagram* pages in the Terminal Procedures Publication), then view them as a finished chart sheet or as a simple surface view with painted markings.

Everything runs in the browser. Work is saved automatically to local storage and can be saved and opened as `.apd.json` files.

## Drawing

| Tool | Key | How |
| --- | --- | --- |
| Select | `V` | Click to select, drag to move, drag handles to reshape. Double-click a taxiway or apron edge to add a point; double-click a point to switch corner ↔ curve. |
| Pan | `H` / hold `Space` | Drag. Scroll or pinch to zoom, `F` to fit. |
| Runway | `R` | **One line**: drag from one threshold to the other (or click, then click). The heading snaps to whole magnetic degrees; hold `Shift` to lock it to the runway number. |
| Taxiway | `T` | **Bezier pen**: click for a corner, click-drag for a curve. `Enter`, or clicking the last point, finishes; `Backspace` removes a point. Points snap to runway centerlines, runway ends and other taxiways. Select a taxiway, then click one of its ends with the pen to extend it. |
| Apron | `A` | Pen for closed shapes; click the first point to close. |
| Building | `B` | Drag a rectangle (`Shift` for a square); reshape it with the select tool. |
| Label | `L` | Click, then type in the panel. |
| Symbol | `S` | Control tower, rotating beacon, wind cone, helipad. |
| Hot spot | `O` | Drag out a circle; the `HS n` callout can be dragged. |

### Taxiway clean-up

- **Rename**: double-click a taxiway's name on the chart, press `F2` (or `Enter`) with it selected, use **Rename** in the bar that appears over the canvas, or double-click it in **Layers**. Names are upper case letters and digits, up to 8 characters.
- **Auto-smooth**: keeps the first and last points and rebuilds the taxiway the way real ones are laid out. A path that never strays far from a straight line becomes one (brief wobbles don't count). Otherwise the drawing is read as straight legs: a curve drawn or clicked out in steps turns into the single corner it implies, while a real straight between two turns keeps them apart. The angles you draw are kept. Only a leg that meets a runway or taxiway within 8° of square is squared to it, and only a runway exit within 5° of 30° becomes exactly 30°. **Turns** picks how corners are rounded:
  - *As drawn* keeps the radius of each curve you drew, so a wide sweeping turn stays wide. It never goes tighter than the FAA minimum.
  - *Tight* uses the minimum centerline radius the FAA tabulates for that width and turn angle (AC 150/5300-13A tables 4-4 to 4-10; e.g. 95 ft for a 90° turn on a 75 ft taxiway).

  **Runway exit** appears when a taxiway starts or ends on a runway. It shows the angle the taxiway leaves the runway at and sets it to *As drawn*, 30° (a high-speed exit), 45° (the widest acute-angled exit AC 150/5300-13A recommends), 90° (the standard), or any angle from 15° to 90°. Picking an angle smooths the taxiway to it. The turn after the exit slides along the next leg, or a straight connector slides along the runway. An exit drawn square leans the way the taxiway carries on. The taxiway remembers its angle, so smoothing it again keeps it.

  A 30° exit is a high-speed exit. It curves off the runway centerline on a 1,500 ft radius, the radius AC 150/5300-13A says such an exit should always have (¶409d(2)). The curve starts 402 ft before the exit's straight line would cross the centerline. A taxiway that already curves off a runway, whether smoothed before or drawn that way, is read by the angle it leaves at once the curve ends.

  Taxiways whose ends were attached to it slide along with it, hold-short lines update, smoothing twice changes nothing, and `Ctrl+Z` undoes it.

`Ctrl+Z` / `Ctrl+Shift+Z` undo and redo, `Ctrl+D` duplicates, arrow keys nudge 10 ft (`Shift`: 100 ft), `?` lists every shortcut.

## What's computed for you

- **Runway numbers** from the magnetic heading (true heading − east variation), with `36` instead of `0` and no leading zero, US-style (optional).
- **L / C / R letters** for parallel runways, ordered left to right as seen on approach. Any number or letter can be overridden per runway end.
- **Hold-short lines** wherever a taxiway enters a runway, at a distance picked from the runway width (overridable). The surface view paints the four-line marking (solid side toward the holding aircraft) and a red holding-position sign whose inscription lists the runway end on the left first, e.g. `8-26`.
- **Taxiway names**: the next free letter, skipping I, O and X.
- **Chart text scale**: text is sized in chart points so the editor matches the printed sheet.

## Making it more detailed

Start with a runway, then add more in layers. The **Inspect** panel's checklist walks through the steps:

1. Runways: length, width, surface (asphalt, concrete, turf, gravel), closed runways, and a one-click **Add parallel runway**.
2. Runway ends: visual, non-precision or precision markings, displaced thresholds, blast pads, threshold elevations.
3. Taxiways: width, name position, and yellow edge lines in the surface view.
4. Aprons, buildings and unpaved areas, with names.
5. Airport details: identifier, city, field elevation, magnetic variation, frequencies, notes, and effective dates.
6. Latitude/longitude of the origin, which adds coordinate ticks (6″ ticks, labels every ½′ or 1′) to the chart border.
7. Hot spots, tower, beacon, wind cone, helipads and free labels.

## Views

- **Edit · FAA chart**: black hard-surface runways, gray taxiways and aprons, black buildings, runway numbers, magnetic headings, `LENGTH X WIDTH` labels and threshold elevations.
- **Edit · Surface**: pavement with threshold bars, designators, centerlines, aiming points, touchdown zone bars, side stripes, displaced-threshold arrows, blast-pad chevrons, taxiway centerlines, hold-short markings and signs.
- **View**: the full chart sheet with title block, frequency box, `FIELD ELEV` box, north and magnetic arrows with variation, scale and coordinate ticks. Export it as SVG or 300 dpi PNG, or print it at TPP page size (5.375 × 8.25 in). The surface view can be exported as PNG.

Symbology follows the FAA airport diagram legend, marking dimensions follow AC 150/5340-1M, and taxiway turn geometry follows AC 150/5300-13A. Charts made here are for fun and illustration. **Not for navigation.**

## Development

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # geometry, designators, hold-short placement, auto-smooth
npm run build      # typecheck + production build into dist/
```

Stack: Vite, React, TypeScript, Zustand, and plain SVG.

```
src/
  model/    data model, geometry (bezier, flattening, curve fitting),
            runway designators, hold-short detection, auto-smooth, sheet layout, sample airport
  render/   ChartLayer (FAA style), SurfaceLayer (markings), Sheet (full chart page)
  editor/   canvas, pan/zoom, tools (runway, pen, rectangle...), snapping, overlays
  store/    document, selection, undo history, autosave
  ui/       toolbar, inspector, layers, airport settings, viewer
  io/       SVG / PNG / JSON export and import
```

Build with `VITE_EMBEDDED=true` for sandboxed frames that block downloads and printing; those controls are then hidden.

To publish on GitHub Pages, set **Settings → Pages → Source** to *GitHub Actions*, then run the **Deploy to GitHub Pages** workflow.
