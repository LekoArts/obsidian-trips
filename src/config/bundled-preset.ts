import type { InstallFile } from './preset-install';

export const presetFiles: InstallFile[] = [
  {
    path: '_templates/Travel_Simple.md',
    content: '---\nbase: "[[_templates/Bases/Travel.base]]"\nbanner:\nstartDate: "{{start_date}}"\nendDate: "{{end_date}}"\nPersons: []\nDone: false\n---\n\n## Shortcuts\n\n> [!info]- Flights\n> **Booking Reference:**\n> \n> **Outbound**\n> \n> {{start_date}}\n> LH123\n> FRA 12:00 - ICN 09:55 (11h 25min)\n> \n> **Return**\n> \n> {{end_date}}\n> LH123\n> ICN 12:10 - FRA 18:15 (13h)\n\n> [!info]- Accommodation\n> \n> **Location ({{start_date}} - {{end_date}})**\n> \n> | Name | Hotel Name |\n> | --- | --- |\n> | Address | Example Address |\n> | Check-in / Check-out | From 15:00 / Until 11:00 |\n> | URL | URL |\n\n> [!tip]+ Good to know\n> Contents\n\n## Activities\n\n- [ ] TBD\n\n## Cost Breakdown\n\n| Name | Price |\n| ---- | ----- |\n|      |       |\n\n## Research\n\n- TBD\n',
  },
  {
    path: '_templates/Travel_Advanced.md',
    content: '---\nbase: "[[_templates/Bases/Travel.base]]"\nbanner:\nstartDate: "{{start_date}}"\nendDate: "{{end_date}}"\nPersons: []\nDone: false\n---\n\n## Shortcuts\n\n> [!info]- Flights\n> **Booking Reference:**\n> \n> **Outbound**\n> \n> {{start_date}}\n> LH123\n> FRA 12:00 - ICN 09:55 (11h 25min)\n> \n> **Return**\n> \n> {{end_date}}\n> LH123\n> ICN 12:10 - FRA 18:15 (13h)\n\n> [!info]- Accommodation\n> \n> **Location ({{start_date}} - {{end_date}})**\n> \n> | Name | Hotel Name |\n> | --- | --- |\n> | Check-in / Check-out | From 15:00 / Until 11:00 |\n> | URL | URL |\n\n> [!tip]+ Good to know\n> Contents\n\n## Itinerary\n\n![[_templates/Bases/Planning.base]]\n\n## Activities\n\n![[_templates/Bases/Activities.base]]\n\n## Cost Breakdown\n\n| Name | Price |\n| ---- | ----- |\n|      |       |\n\n## Research\n\n- TBD\n',
  },
  {
    path: '_templates/Travel_Roadtrip.md',
    content: '---\nbase: "[[_templates/Bases/Travel.base]]"\nbanner:\nstartDate: "{{start_date}}"\nendDate: "{{end_date}}"\nPersons: []\nDone: false\n---\n\n## Shortcuts\n\n> [!info]- Flights\n> **Booking Reference:**\n> \n> **Outbound**\n> \n> {{start_date}}\n> LH123\n> FRA 12:00 - ICN 09:55 (11h 25min)\n> \n> **Return**\n> \n> {{end_date}}\n> LH123\n> ICN 12:10 - FRA 18:15 (13h)\n\n> [!tip]+ Good to know\n> Contents\n\n## Itinerary\n\n![[_templates/Bases/Roadtrip.base]]\n\n## Activities\n\n- [ ] TBD\n\n## Cost Breakdown\n\n| Name | Price |\n| ---- | ----- |\n|      |       |\n\n## Research\n\n- TBD\n',
  },
  {
    path: '_templates/Planning.md',
    content: '---\nbase: "[[_templates/Bases/Planning.base]]"\nbacklink:\nstartDate: "{{start_date}}"\nendDate: "{{end_date}}"\nActivities: \n---\n',
  },
  {
    path: '_templates/Stop.md',
    content: '---\nbase: "[[_templates/Bases/Roadtrip.base]]"\nbacklink:\nstartDate: "{{start_date}}"\nendDate: "{{end_date}}"\n---\n\n## Location\n\n**Name**\n\nAddress\nCheck-in / Check-out: 15:00 / 11:00\nExtra information: TBD\n\n## Activities\n\nTBD\n',
  },
  {
    path: '_templates/Activity.md',
    content: '---\nbase: "[[_templates/Bases/Activities.base]]"\nbacklink:\nLocation:\nDone: false\n---\n',
  },
  {
    path: '_templates/Bases/Travel.base',
    content: 'filters:\n  and:\n    - base == link("_templates/Bases/Travel.base")\n    - file.folder.startsWith("Travel")\nformulas:\n  year: date(startDate).year\nproperties:\n  file.name:\n    displayName: Name\n  Persons:\n    displayName: Persons\nviews:\n  - type: table\n    name: Overview\n    groupBy:\n      property: formula.year\n      direction: DESC\n    order:\n      - file.name\n      - Done\n      - startDate\n      - endDate\n      - Persons\n    sort:\n      - property: startDate\n        direction: ASC\n    columnSize:\n      file.name: 184\n      note.Done: 72\n      note.startDate: 134\n      note.endDate: 138\n      note.Persons: 508\n  - type: cards\n    name: Cards\n    groupBy:\n      property: formula.year\n      direction: DESC\n    sort:\n      - property: startDate\n        direction: ASC\n    image: note.banner\n    imageAspectRatio: 0.55\n',
  },
  {
    path: '_templates/Bases/Planning.base',
    content: 'filters:\n  and:\n    - base == link("_templates/Bases/Planning.base")\n    - file.hasLink(this)\nviews:\n  - type: table\n    name: Planning\n    order:\n      - file.name\n      - startDate\n      - endDate\n      - Activities\n    sort:\n      - property: startDate\n        direction: ASC\n    columnSize:\n      file.name: 139\n      note.startDate: 130\n    rowHeight: medium\n',
  },
  {
    path: '_templates/Bases/Activities.base',
    content: 'filters:\n  and:\n    - base == link("_templates/Bases/Activities.base")\n    - file.hasLink(this)\nviews:\n  - type: table\n    name: Activities\n    groupBy:\n      property: Location\n      direction: ASC\n    order:\n      - file.name\n      - Done\n    sort:\n      - property: file.name\n        direction: ASC\n    columnSize:\n      file.name: 626\n    cardSize: 180\n  - type: table\n    name: Grouped by location\n    groupBy:\n      property: Location\n      direction: ASC\n    order:\n      - file.name\n      - Done\n    sort:\n      - property: file.name\n        direction: ASC\n    columnSize:\n      file.name: 626\n',
  },
  {
    path: '_templates/Bases/Roadtrip.base',
    content: 'filters:\n  and:\n    - base == link("_templates/Bases/Roadtrip.base")\n    - file.hasLink(this)\nviews:\n  - type: table\n    name: Roadtrip\n    order:\n      - file.name\n      - startDate\n      - endDate\n    sort:\n      - property: startDate\n        direction: ASC\n    columnSize:\n      file.name: 204\n      note.startDate: 121\n',
  },
];
