# View components for agent-built views

Status: design draft (lina-app#66, lina#329)

This note defines the one component set that agents compose into in-app views, the input parts and the shared capture flow, the minimal view spec, and what the set deliberately does not cover. Nothing here is built yet. Build order is not decided in this note; follow-up issues are grouped by component family only.

The set was derived from two sources: 33 proposed app features across seven domains (work/business, legal & tax, creative, people & notes, infrastructure, life, investing), and five boards that agents run today as hand-made pages (an archive-compression board, the work dashboard, an equipment page, a weekly change report image, a portfolio board). A feature-by-component table is in the appendix.

## Rules shared by every component

- Plain JSON in, design tokens out: system font, three text sizes, one accent colour, light and dark. Components never take colours, fonts or sizes from the spec.
- Three widths: **wide** (main area on a computer), **narrow** (side detail panel, a view pinned to the home side panel, or a card inline in the conversation) and **phone**.
- Status words come from the shared word list only. `state` is one of `planned`, `in_progress`, `waiting`, `stopped`, `done`, plus the listed review and failure words. Domain stages (draft, sent, signed, filed and so on) are not states; they go in a row's `sub` text.
- Empty: one line "none" in the app's empty style. Loading: grey placeholder of the same size with the loading word. Error (the source could not be read): the last good data stays, and the view head shows the stale or offline word. Spec errors never reach the screen; they are refused at save time.
- Writes: no component writes to the store. Buttons and inputs send one message through the message path (lina#309) to the view's owner session; irreversible actions (delete, format, submit for approval, send in the owner's name, spend, change credentials or permissions) go through the approval path (lina#322).
- Images, audio and files are stored attachment ids. Outside URLs are refused for media; plain links are allowed.

## Display components (most used first)

"Uses" counts features (out of 33) and boards (out of 5) that need the component on their first screen or their detail.

### `list` - List

- Uses: 24 features, 3 boards
- Sizes: Wide: two-line rows (title / grey second line) with the trail at the right end. Narrow: same two lines, the trail moves to the second line. Phone: full-width rows; a tap opens the detail full screen with swipe back.
- States: see the shared rule above.
- Write path: Row `actions` are `choice` buttons and go through the message path (#309); an irreversible action goes through the approval path (#322). The list itself writes nothing.
- In the app today: `CardRowView`, `ListSection`, `SectionHead`, `Disclosure`, `Link` (the row shape is reused; the row data must stop assuming a work card).
- Data:

```json
{
  "rows": [
    {
      "title": "Example item",
      "sub": "Example line",
      "state": "in_progress",
      "trail": {
        "date": "2026-01-02",
        "kind": "due"
      },
      "thumb": null,
      "tags": [
        "example"
      ],
      "href": "example-detail",
      "actions": [
        {
          "id": "keep",
          "label": "Example"
        }
      ]
    }
  ]
}
```

### `stat-row` - Number tiles

- Uses: 19 features, 5 boards
- Sizes: Wide: up to six tiles in a row. Narrow: three per row, then wrap. Phone: two per row; a single big number takes the full row.
- States: see the shared rule above. A tile with `hideWhenZero` is hidden at zero.
- Write path: None. A tap only navigates to `href`.
- In the app today: `CountPair`, `Box`; there is no big-number tile yet (new).
- Data:

```json
{
  "tiles": [
    {
      "label": "Example",
      "value": 1234,
      "unit": "kg",
      "ref": {
        "label": "Example",
        "value": 1200
      },
      "delta": -3,
      "hideWhenZero": true,
      "href": null
    }
  ]
}
```

### `status-tag` - Status tag

- Uses: 11 features, 5 boards
- Sizes: Same at every width: dot plus word on narrow and phone, word only inside a wide table cell.
- States: see the shared rule above.
- Write path: None.
- In the app today: `StateText`, `StateTime`, `stateLabel`.
- Data:

```json
{
  "state": "in_progress",
  "reason": null,
  "since": 1700000000
}
```

### `due-tag` - Due tag

- Uses: 10 features, 0 boards
- Sizes: One word at the row end (overdue / today / this week / later, or the date) on wide and narrow; second line on the phone.
- States: see the shared rule above. An `estimated` date is grey and marked for review.
- Write path: None.
- In the app today: `DueDate` in the list screens.
- Data:

```json
{
  "date": "2026-01-02",
  "kind": "due",
  "estimated": false
}
```

### `group` - Collapsible group

- Uses: 7 features, 2 boards
- Sizes: Wide: one head line (name, meta, status, progress). Narrow and phone: progress moves to a second line. Children are `list`, `table` or `group`, two levels deep at most.
- States: see the shared rule above. Groups holding stopped or failed rows always start open.
- Write path: None. Open or closed is remembered on this device only.
- In the app today: `SectionHead` plus `Disclosure` come close; collapsing is new.
- Data:

```json
{
  "groups": [
    {
      "title": "Example group",
      "meta": "12",
      "state": "in_progress",
      "progress": {
        "done": 3,
        "total": 5
      },
      "open": false,
      "children": []
    }
  ]
}
```

### `table` - Table

- Uses: 6 features, 3 boards
- Sizes: Wide: every column. Narrow: only `primary` columns. Phone: each row folds into a label-value card.
- States: see the shared rule above. Long tables draw the first page and page on.
- Write path: None. Sorting happens on screen.
- In the app today: None (new). Machine and quota rows are rows, not a table.
- Data:

```json
{
  "columns": [
    {
      "key": "name",
      "label": "Example",
      "align": "start",
      "primary": true
    },
    {
      "key": "value",
      "label": "Example",
      "align": "end",
      "format": "number"
    }
  ],
  "rows": [
    {
      "name": "Example vendor",
      "value": 1234
    }
  ],
  "sort": "value"
}
```

### `progress` - Progress bar

- Uses: 4 features, 3 boards
- Sizes: Wide: bar plus number. Narrow: shorter bar, same number. Phone: one line under the row. Also takes `{"percent":72,"high":90}` or `{"value":1234,"ref":1500}`; `style: dial` draws a ring.
- States: see the shared rule above.
- Write path: None.
- In the app today: `Progress`, `Meter`, `Dial`.
- Data:

```json
{
  "done": 3,
  "total": 5
}
```

### `markdown` - Markdown block

- Uses: 4 features, 2 boards
- Sizes: Only line wrapping changes with width; `mono` uses a fixed-width font (for a log tail). Headings, lists, bold, links and code only; no images, HTML or scripts.
- States: see the shared rule above.
- Write path: None.
- In the app today: None (new).
- Data:

```json
{
  "text": "Example **text** with a [link](example-detail).",
  "mono": false
}
```

### `grid` - Image grid

- Uses: 4 features, 1 boards
- Sizes: Wide: four to six tiles a row. Narrow: two or three. Phone: two. Tiles without an image show text only. `image` is a stored attachment id, never an outside URL.
- States: see the shared rule above.
- Write path: Tile `actions` are `choice` buttons (#309).
- In the app today: None (new).
- Data:

```json
{
  "tiles": [
    {
      "title": "Example",
      "image": "attachment-1",
      "caption": "Example",
      "tags": [
        "example"
      ],
      "state": null,
      "href": "example-detail",
      "actions": [
        {
          "id": "keep",
          "label": "Example"
        },
        {
          "id": "drop",
          "label": "Example"
        }
      ]
    }
  ]
}
```

### `fields` - Label-value pairs

- Uses: 4 features, 1 boards
- Sizes: Wide: two columns. Narrow and phone: label above value.
- States: see the shared rule above.
- Write path: None. Corrections are one `say` line (#309).
- In the app today: Settings rows (`PlainRow`, `ReadOnlyLine`) come close.
- Data:

```json
{
  "pairs": [
    {
      "label": "Example",
      "value": "Example value",
      "href": null
    }
  ]
}
```

### `filter-bar` - Search and filter

- Uses: 3 features, 1 boards
- Sizes: Wide: search box and pills on one line. Narrow: pills scroll sideways. Phone: search above, one scrolling row of pills below.
- States: see the shared rule above.
- Write path: None. Query and filter stay on this device.
- In the app today: None (new); the Korean-aware text matcher can be reused.
- Data:

```json
{
  "search": true,
  "filters": [
    {
      "id": "example",
      "label": "Example",
      "count": 12
    }
  ],
  "target": "example-list"
}
```

### `timeline` - Timeline

- Uses: 3 features, 1 boards
- Sizes: Wide: time, dot, line, evidence link. Narrow and phone: time moves above the line.
- States: see the shared rule above.
- Write path: None.
- In the app today: `Timeline`, `RunModelLine` (run-specific today; the item shape must be generalised).
- Data:

```json
{
  "items": [
    {
      "at": 1700000000,
      "who": "agent-example",
      "line": "Example line",
      "basis": "source",
      "href": "example-detail"
    }
  ],
  "order": "newest"
}
```

### `line-chart` - Line chart

- Uses: 3 features, 1 boards
- Sizes: Wide: tall, legend at the right. Narrow: legend below. Phone: full width, only the last value as text. Missing days are drawn dashed.
- States: see the shared rule above.
- Write path: None.
- In the app today: None (new).
- Data:

```json
{
  "x": "date",
  "series": [
    {
      "label": "Example",
      "points": [
        [
          "2026-01-01",
          1234
        ],
        [
          "2026-01-08",
          1230
        ]
      ],
      "avg": "week"
    }
  ],
  "ref": {
    "label": "Example",
    "value": 1200
  },
  "zero": false
}
```

### `media` - Media viewer

- Uses: 2 features, 0 boards
- Sizes: Wide: natural ratio. Narrow and phone: fit to width. Audio and video use the platform's own play control; no waveform.
- States: see the shared rule above.
- Write path: None.
- In the app today: None (new).
- Data:

```json
{
  "kind": "audio",
  "file": "attachment-1",
  "poster": null,
  "caption": "Example"
}
```

### `strip` - Horizontal strip

- Uses: 2 features, 0 boards
- Sizes: Wide: all items on one line. Narrow and phone: scrolls sideways.
- States: see the shared rule above.
- Write path: None. Reordering is a `say` line.
- In the app today: None (new).
- Data:

```json
{
  "items": [
    {
      "title": "Example",
      "sub": "Example",
      "value": 3,
      "href": "example-detail"
    }
  ],
  "order": "fixed"
}
```

### `range-bar` - Range bar

- Uses: 2 features, 0 boards
- Sizes: Wide: a grey band with a value dot per row. Narrow and phone: same shape, numbers on a second line. Outside the band is only marked, never judged.
- States: see the shared rule above.
- Write path: None.
- In the app today: None (new).
- Data:

```json
{
  "rows": [
    {
      "label": "Example",
      "low": 10,
      "high": 20,
      "base": 15,
      "value": 22,
      "outside": true
    }
  ]
}
```

### `bar-chart` - Bar chart

- Uses: 1 features, 2 boards
- Sizes: Wide: label, bar, value, secondary value. Narrow and phone: secondary value hidden; vertical bars turn horizontal.
- States: see the shared rule above.
- Write path: None.
- In the app today: None (new).
- Data:

```json
{
  "bars": [
    {
      "label": "Example",
      "value": 42,
      "ref": 40,
      "tone": null
    }
  ],
  "orientation": "horizontal",
  "unit": "%"
}
```

### `banner` - Banner

- Uses: 0 features, 1 boards
- Sizes: One line at the top of the view at every width; wraps when long.
- States: see the shared rule above.
- Write path: None.
- In the app today: `ErrorLine` comes close.
- Data:

```json
{
  "tone": "warning",
  "line": "Example line",
  "href": null
}
```

## Input parts

Every input sends exactly one message through lina#309 to the owner session of the view. A `choice` option with `approval: true` raises an approval request through lina#322 instead of acting.

### `say` - One line

- Uses: 23 features
- Write path: lina#309
- In the app today: Talk input with Korean composition handling (`KoreanInput`, `Talk`).

```json
{
  "part": "say",
  "kind": "example-kind",
  "hint": "Example"
}
```

### `choice` - Choice buttons (one to three)

- Uses: 14 features
- Write path: lina#309; options with `approval: true` go through lina#322
- In the app today: Decision buttons, retry control.

```json
{
  "part": "choice",
  "options": [
    {
      "id": "keep",
      "label": "Example"
    },
    {
      "id": "drop",
      "label": "Example"
    }
  ],
  "approval": false
}
```

### `photo` - One photo

- Uses: 6 features
- Write path: lina#309
- In the app today: None (new); same attachment path as the conversation.

```json
{
  "part": "photo",
  "kind": "example-kind",
  "hint": "Example"
}
```

### `file-drop` - File drop

- Uses: 6 features
- Write path: lina#309
- In the app today: None (new). Drag and drop on a computer, file picker on the phone.

```json
{
  "part": "file-drop",
  "kind": "example-kind",
  "accept": [
    "pdf",
    "image"
  ]
}
```

### `quick-add` - Quick add (date in words)

- Uses: 5 features
- Write path: lina#309
- In the app today: Same box as `say`; the agent reads the date and shows it on the draft card.

```json
{
  "part": "quick-add",
  "kind": "example-kind",
  "needs": [
    "date"
  ]
}
```

### `check` - Check

- Uses: 2 features
- Write path: lina#309
- In the app today: `DoneCheck`, `CheckBox`, the five-second undo toast. Today it writes through the work API; in a view the same tap is a message.

```json
{
  "part": "check",
  "id": "example-item",
  "done": false
}
```

### `form` - Form

- Uses: 1 features
- Write path: lina#309
- In the app today: Settings rows (`ChoiceRow`, `StepperRow`, `Switch`) come close.

```json
{
  "part": "form",
  "fields": [
    {
      "key": "name",
      "label": "Example",
      "type": "text",
      "required": true
    }
  ]
}
```

### `draft-card` - Draft check

Shown by the capture flow below: the fields the agent filled, one question per missing required field, and two answers (it is right / one-sentence correction). Closest today: the decision box on goals and cards. Write path: lina#309.

```json
{
  "part": "draft-card",
  "kind": "example-kind",
  "fields": [
    {
      "key": "menu",
      "value": "Example dish",
      "from": "photo"
    }
  ],
  "missing": [
    "place"
  ],
  "question": "Example question?"
}
```

## Shared capture flow (one photo or one line becomes one record)

Used by, for example: a meal photo (life: meal log), an invoice or receipt photo (legal & tax: tax calculator), a draft or reference image (creative: character sheet, reference shelf), a one-line update (people & notes: relationship trends, and a private journal kept on one device), and a holdings screenshot on a day the feed is down (investing: account).

| Step | Screen | Who | Write path |
|---|---|---|---|
| 1. Put in | `photo`, `say`, `file-drop` or `quick-add` in the view, or the same in the conversation | owner | lina#309 message (place: this view, target: owner session, intent: instruction), attachment on the message |
| 2. Fill fields | view head shows in progress | agent fills the record kind's field contract (lina#302); fields outside the contract are refused | none (draft, not saved) |
| 3. Ask for gaps | `draft-card` with one question per missing required field | agent | lina#309 message (intent: question); the answer releases only that question |
| 4. Confirm or correct | `draft-card`: confirm, or one-sentence correction (lina#303) | owner | lina#309 message (intent: answer); a correction is kept as a new version |
| 5. Save | draft card closes, one short notice | agent writes one record under the contract (lina#302); derived values such as a day total are computed by the store | through the lina#309 result; irreversible effects (format, delete, submit, send in the owner's name, spend) only after a lina#322 approval |
| 6. Show | view re-reads on its `on event` rule | app and core, no model call | none |

Records made from private material are served to the owner only, and the private journal never leaves its one device.

## View spec (minimal shape)

One JSON document per view. Agents create, update and remove it through the one core API (lina#329); there is no per-view process or port. The core stores it with owner agent, version and last change, validates it against this component set at save time, and refuses unknown parts, unknown state words, outside media URLs, and scripts, with one clear error line back to the agent.

```json
{
  "id": "example-view",
  "version": 1,
  "title": "Example view",
  "owner": "agent-example",
  "place": {
    "section": "agent",
    "pinnable": true,
    "chatCard": {
      "numbers": [
        "summary.total"
      ],
      "line": "summary.change"
    }
  },
  "sources": [
    {
      "id": "summary",
      "kind": "store",
      "query": {
        "records": "example-kind",
        "aggregate": "count"
      },
      "refresh": {
        "on": "event"
      }
    },
    {
      "id": "rows",
      "kind": "store",
      "query": {
        "records": "example-kind",
        "where": {
          "state": [
            "planned",
            "in_progress",
            "waiting"
          ]
        },
        "order": "due"
      },
      "refresh": {
        "on": "event"
      }
    },
    {
      "id": "report",
      "kind": "file",
      "file": "example-view-data.json",
      "refresh": {
        "on": "change"
      }
    },
    {
      "id": "probe",
      "kind": "command",
      "command": "example-readonly-command",
      "refresh": {
        "every": "60s"
      }
    }
  ],
  "layout": [
    {
      "part": "stat-row",
      "from": "summary",
      "map": {
        "tiles": "tiles"
      }
    },
    {
      "part": "filter-bar",
      "target": "main-list",
      "filters": [
        {
          "id": "open",
          "label": "Example"
        }
      ]
    },
    {
      "part": "list",
      "id": "main-list",
      "from": "rows",
      "map": {
        "title": "name",
        "sub": "stage",
        "state": "state",
        "trail": "due",
        "href": "detail"
      }
    },
    {
      "part": "markdown",
      "data": {
        "text": "Example note."
      }
    }
  ],
  "detail": {
    "from": "rows",
    "layout": [
      {
        "part": "fields",
        "map": {
          "pairs": "fields"
        }
      },
      {
        "part": "timeline",
        "from": "rows",
        "path": "history"
      }
    ]
  }
}
```

- `title`, `owner`: shown in the view head; only the owner agent may update or remove its views.
- `sources`: `store` (records, work runs, activity), `file` (a file the agent keeps updated) or `command` (a read-only command whose result the core caches). Each source has its own refresh rule and the core records its last success time; the view head shows the update age, or the stale and offline words when a source fails.
- `refresh`: `{"every": "60s"}`, `{"on": "event"}` (store changes) or `{"on": "change"}` (file). Refreshing never runs the agent's model; the agent changes only the spec.
- `layout`: an ordered list of component nodes. A node takes `data` inline, or `from` (a source id) plus optional `path` and `map` (component field to source field).
- `detail`: the layout opened from a row's `href`.
- `place`: the view is a page in its agent's section, pinnable to the home side panel, and can appear inline in the conversation as a card (title, one or two numbers, one change line). Each view has a stable in-app address (agent and id).

## Not covered by components

| Need | Seen in | Decision | Why |
|---|---|---|---|
| Map | no feature | leave out | Nothing needs it, and map tiles would load outside code. Revisit as a web block if a need appears. |
| Range band | people & notes: relationship trends; investing: simulations | one more component (`range-bar`) | Two domains need it, and it is a band plus a dot with no script. |
| Count-down schedule bar | work/business: release timeline | leave out | The first screen is the next three deadlines: `list` plus `due-tag`. |
| Section map of a song | creative: song board | leave out | One `progress` row per section carries the same facts. |
| Waveform and playback | creative: draft box | playback as one more component (`media`); waveform left out | Listening is needed to keep or drop a draft; the waveform is not. |
| Drag to reorder | people & notes: people | leave out | One place, rare change; one `say` line updates the order field. |
| Month calendar | work/business: settlement calendar, my schedule; legal & tax: tax calendar | leave out | All three describe date-ordered lists: a `group` per day plus `list`. |
| Two-axis chart | investing: trading journal | leave out | Two `line-chart` blocks stacked on the same x axis read better on a phone. |
| Long-press menu | infrastructure: shortcuts; people & notes: people | leave out | A row or tile `choice` does the same and is easier to find. |

### Web block exception

No current feature or board needs it, but the rule is fixed now so agents do not fall back to hand-made pages.

- Refused by default. A `web` node is saved only after the owner allows it for that one view through lina#322.
- Content is one HTML string inside the spec. No network, no outside code; it runs in a sandboxed frame on a separate origin and cannot reach the store, the write paths or other views.
- No writes from inside the block; buttons stay outside it as `choice`.
- Fixed height from the spec, and the frame always shows that it is a web block and which agent owns it.
- When the same block is used by more than two views, a follow-up issue turns it into a component.

## Appendix: features by component

| Feature | Display components | Inputs |
|---|---|---|
| work/business: approval queue | `stat-row` `list` `status-tag` `fields` | `say` `choice` `check` |
| work/business: vendor cards | `filter-bar` `list` `fields` | `say` `file-drop` |
| work/business: settlement calendar | `stat-row` `list` `status-tag` `due-tag` | `file-drop` `say` |
| work/business: my schedule | `group` `list` `due-tag` | `quick-add` |
| work/business: release timeline | `list` `due-tag` `status-tag` | `quick-add` `say` |
| legal & tax: contract box | `stat-row` `list` `due-tag` | `file-drop` |
| legal & tax: settlement status | `stat-row` `table` `status-tag` | `file-drop` |
| legal & tax: work registration | `stat-row` `list` `due-tag` `status-tag` | `say` `file-drop` |
| legal & tax: tax calculator | `table` | `say` `photo` |
| legal & tax: tax calendar | `list` `due-tag` `status-tag` | `quick-add` |
| creative: draft box | `stat-row` `grid` `media` | `choice` |
| creative: character sheet | `grid` `markdown` `list` | `photo` `say` `choice` |
| creative: song board | `list` `progress` `timeline` | `say` `file-drop` |
| creative: reference shelf | `filter-bar` `list` `media` `markdown` | `say` `photo` |
| people & notes: people | `strip` `group` `list` `status-tag` `fields` `timeline` | `say` `choice` |
| people & notes: relationship trends | `strip` `range-bar` `timeline` | `say` `choice` |
| people & notes: library | `stat-row` `list` `markdown` | `say` `choice` |
| people & notes: a private journal kept on one device | `stat-row` `list` `markdown` | `say` |
| people & notes: dates to remember | `stat-row` `group` `list` `due-tag` | `quick-add` `choice` |
| infrastructure: backup box | `stat-row` `list` `due-tag` `group` `status-tag` | `choice` `say` |
| infrastructure: shortcuts | `stat-row` `grid` `status-tag` | `choice` |
| infrastructure: storage | `stat-row` `group` `progress` `list` | `choice` |
| infrastructure: subscriptions and expiry | `stat-row` `list` `due-tag` | `quick-add` `choice` |
| infrastructure: home devices | `stat-row` `group` `list` `status-tag` | `choice` `form` `say` |
| life: meal log | `stat-row` `progress` `grid` | `photo` `say` `check` |
| life: body change | `stat-row` `line-chart` `progress` | `say` |
| life: gear box | `stat-row` `filter-bar` `list` `status-tag` `fields` | `say` `choice` |
| life: item search | `list` `table` | `say` `photo` `choice` |
| investing: account | `stat-row` `table` `line-chart` | `photo` |
| investing: exposure | `stat-row` `bar-chart` `table` | `say` |
| investing: trading journal | `line-chart` `list` `group` | `say` |
| investing: simulations | `list` `range-bar` `table` | `say` |
| investing: investment notes | `list` `due-tag` | `say` |

| Board | Components |
|---|---|
| archive-compression board | `stat-row` `progress` `status-tag` `group` `table` `list` `markdown` |
| work dashboard | `stat-row` `list` `status-tag` `progress` `timeline` `table` |
| equipment page | `stat-row` `filter-bar` `group` `grid` `status-tag` `markdown` |
| weekly change report image | `stat-row` `progress` `bar-chart` `line-chart` `status-tag` |
| portfolio board | `banner` `stat-row` `fields` `bar-chart` `table` `status-tag` `list` |
