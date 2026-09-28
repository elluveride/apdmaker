# APD Maker

Draw custom airport diagrams that look like FAA charts (the *Airport Diagram* pages in the Terminal Procedures Publication), then view them as a finished chart sheet or as a simple surface view with painted markings.

It also builds **SIDs and STARs** as terminal-procedures pages, and shows every real airport, navaid and US fix on a **map** next to the airports you've made.

Everything runs in the browser. Work is saved automatically to local storage. The bar at the bottom of the sidebar has **Save .json**, which saves the airport file you can open again later, and **Export .jpg**, which exports the chart sheet at 300 dpi. Both are there on every tab.

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

### Tracing a picture

Work from a satellite view, photo or scanned chart:

1. Paste a screenshot, drop an image on the canvas, or use **File → Trace a reference image…**. It fills the view, under everything you draw.
2. In **Airport → Reference image**, turn it so true north is straight up if it isn't, and set how faint it is.
3. Draw a runway along one in the picture, then type that runway's real length in its **Real length** box. The picture and everything drawn scale together around the runway, so the rest of the airport you trace is to scale. Widths and hold distances are real sizes and keep their feet.

The picture shows only while editing. It never appears in View mode, exports or prints. It is saved with the airport file and kept after a reload.

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
- **View**: the full chart sheet with title block, frequency box, `FIELD ELEV` box, north and magnetic arrows with variation, scale and coordinate ticks. Export it as a 300 dpi JPG or PNG, or as SVG, or print it at TPP page size (5.375 × 8.25 in). The surface view can be exported as PNG.

Symbology follows the FAA airport diagram legend, marking dimensions follow AC 150/5340-1M, and taxiway turn geometry follows AC 150/5300-13A. Charts made here are for fun and illustration. **Not for navigation.**

## My airports

Click the airport name in the top bar to open **My airports**. Each airport you make is kept separately and saved as you work; open, copy or delete them there. Start a **New blank** airport, open a saved `.json` file, load the sample, or start **From a real airport**.

### Starting from a real airport

Pick a real airport on the map and choose **Start a chart from this airport**. Its runways are laid out between their real threshold coordinates, with their lengths, widths, surfaces and designators, and its frequencies and magnetic variation are filled in. Runway data comes from OurAirports, which is maintained by volunteers, so check it against the real diagram. Taxiways, aprons and buildings are yours to draw; trace a satellite picture for those.

## Map

**Map** shows:

- every open airport in the world (large and medium ones at any zoom, small ones, heliports and seaplane bases as you zoom in)
- VORs, VOR/DMEs, VORTACs, TACANs, DMEs and NDBs, from zoom 6
- US fixes and RNAV waypoints, from zoom 9
- your airports in magenta, with their SIDs (blue) and STARs (green)

Search by identifier or name. A real US airport links to its current FAA airport diagram PDF. One of yours shows its chart, opens it, or lists its procedures. An airport of yours without a position asks you to click the map to place it; **Move on map** does it again.

## SIDs & STARs

**SIDs & STARs** builds departure and arrival procedures for the open airport. Place the airport on the map first so the procedures know where they are.

- A procedure is made of **runway** routes, an optional **common** route, and **transitions**. Each route is a list of legs: fly to a fix, or fly a heading (to an altitude, or for radar vectors when it's the last leg).
- Type a fix's identifier. Navaids worldwide and US fixes and waypoints within range of the airport are suggested. **Add a custom fix** makes your own from a radial and distance off a navaid (using the airport's magnetic variation) or from a latitude and longitude.
- Each fix can take an altitude limit (at or above, at or below, both for a mandatory altitude or a window) and a speed. They are drawn the FAA way: a line under a minimum, over a maximum, both for a mandatory altitude.
- The route description (`TAKEOFF RUNWAY 26L: CLIMB HEADING 262° TO 3000, THEN DIRECT PXR VORTAC.`) and transition codes (`CACTU1.BLH`) are written for you. Add a *maintain* and *expect* clause and notes.
- The chart is drawn not to scale, as real ones are: bearings from the airport are true, and distance is compressed so the turns near the runway fit on the page with a long transition. Export it as a 300 dpi JPG.

## Data sources

- Airports, runways, frequencies and navaids: [OurAirports](https://ourairports.com/data/), public domain.
- US fixes and waypoints: the FAA's [28-day NASR subscription](https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/), for the current AIRAC cycle.
- Airport diagram links: the FAA's [digital Terminal Procedures Publication](https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/dtpp/) metafile.
- Map tiles: [OpenStreetMap](https://www.openstreetmap.org/copyright), under its [tile usage policy](https://operations.osmfoundation.org/policies/tiles/). Set `VITE_MAP_TILES` to another `{z}/{x}/{y}` tile URL to use your own tile server.

`npm run navdata` downloads these into `public/navdata/`: large and medium airports in one file, everything else and the fixes in tiles fetched as the map moves. The Pages workflow runs it on every deploy and every Monday, so the published data follows the FAA's cycles. The map and procedures work without it, just without real data.

## Development

```sh
npm install
npm run navdata    # optional: real airports, navaids and fixes into public/navdata
npm run dev        # http://localhost:5173
npm test           # geometry, designators, hold-short placement, auto-smooth, navdata, procedures
npm run build      # typecheck + production build into dist/
```

Stack: Vite, React, TypeScript, Zustand, Leaflet, and plain SVG.

```
src/
  model/    data model, geometry (bezier, flattening, curve fitting),
            runway designators, hold-short detection, auto-smooth, sheet layout, sample airport,
            procedures (routes, wording), airports from real data
  render/   ChartLayer (FAA style), SurfaceLayer (markings), Sheet (full chart page),
            ProcedureChart (SID / STAR page)
  editor/   canvas, pan/zoom, tools (runway, pen, rectangle...), snapping, overlays
  store/    document, selection, undo history, autosave, airport library
  nav/      real navigation data: loading, great-circle math, OurAirports runways
  map/      the map and its chart symbols
  proc/     the SID / STAR editor
  ui/       toolbar, inspector, layers, airport settings, viewer, library
  io/       SVG / PNG / JPG / JSON export and import
scripts/    navdata.mjs: builds public/navdata from OurAirports and the FAA
```

Build with `VITE_EMBEDDED=true` for sandboxed frames that block downloads and printing, such as a claude.ai artifact. Printing is then hidden. A dialog then shows each file to save by hand: right-click the chart image to save it, or copy the airport file's text. Build with `VITE_ARTIFACT_RUNTIME=true` too, and publish with the artifact's `downloads` capability, to save through the viewer's save prompt instead.

To publish on GitHub Pages, set **Settings → Pages → Source** to *GitHub Actions*. The **Deploy to GitHub Pages** workflow then publishes every push to `main`, and it can also be run by hand. A custom domain goes in the same settings page, with a `CNAME` DNS record pointing at `<user>.github.io`; GitHub ignores a `CNAME` file when it publishes from Actions. Scheduled runs only happen on the default branch.
