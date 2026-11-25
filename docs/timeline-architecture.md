# Timeline Architecture

The redesigned timeline keeps the existing Sherlock data models and API contracts intact. It treats events, actions, evidence links, people links, and relationships as read-only inputs and changes only the client-side presentation layer.

## Component Structure

- `TimelineExperience` owns timeline state, navigation, zoom, density, filtering, persisted preferences, virtualization, and rendering orchestration.
- `TimelineToolbar` keeps search, filters, zoom, date navigation, density, colour mode, saved views, focus, relationships, bookmarks, and markers in one compact control row.
- `TimelineGrid` renders time ticks, activity heatmap, weekend shading, working-hours overlay, bookmarks, and annotated dates.
- `TimelineLaneHeader` renders sticky lane headers with collapse, resize, drag reorder, and persisted order.
- `TimelineEvent` renders visible event cards in overview, medium, and expanded density modes.
- `TimelineCluster` aggregates dense collision groups and expands them into a temporary fan layout.
- `TimelineRelationships` draws relationship connectors only for focused or explicitly requested graph states.
- `TimelineMinimap` uses canvas for the overview map so the main DOM can stay focused on visible cards.
- `FloatingTimelineInspector` replaces the older sidebar treatment with a compact inspector made of collapsible sections.

## Layout Model

Events are normalized into semantic lanes, then packed with interval graph colouring. Each lane keeps a list of row end positions. Events are processed chronologically and placed in the first row whose last occupied pixel does not collide with the event's new interval. If no row is available, a new row is created. This guarantees that visible cards never overlap while minimizing vertical height for the lane.

The algorithm uses visual width, not only raw event duration, because many investigation events are instant points in time but still need readable cards. Point events therefore reserve a minimum width based on the current density mode.

## Density And Clustering

Density is derived from zoom unless the investigator overrides it:

- Overview: compact coloured pills with icon and duration/time.
- Medium: icon, title, and timestamp.
- Expanded: title, metadata, people, tags, duration/status, and pin affordance.

Dense time buckets become clusters when drawing individual events would create noise. Cluster thresholds adapt by density. Clicking a cluster expands it into a temporary fan layout; hovering previews the contents without opening a modal.

## Performance

The timeline uses a large scrollable coordinate space but only renders cards inside the current viewport plus overscan. This keeps DOM card count bounded while supporting large event sets. The minimap and activity overview are drawn to canvas. Layout calculations are memoized from stable inputs: events, actions, relationships, lane preferences, zoom, and density.

## Interaction

Navigation supports natural trackpad scrolling, shift-wheel horizontal scroll, explicit modifier-wheel zoom, zoom controls, drag panning, double-click zoom, fit, today, investigation start, latest activity, date jump, minimap jump, keyboard arrow selection, plus keyboard zoom. Lane order, collapse state, lane height, lane category width, bookmarks, markers, and pinned events persist in local storage.

Relationship lines are intentionally quiet. They are hidden by default, appear for the focused event on hover/selection, and can be explicitly expanded through relationship mode. Focus mode fades unrelated events using people, evidence, and relationship matches.

## Accessibility

The timeline is keyboard focusable and exposes selected cards with `aria-selected`. Controls use labels or titles, visible focus rings, muted semantic colour with a bright cyan selected state, and respect reduced motion through Framer Motion's reduced-motion hook where smooth scrolling is triggered.
