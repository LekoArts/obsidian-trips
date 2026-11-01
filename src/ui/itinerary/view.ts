import type { ViewStateResult, WorkspaceLeaf } from 'obsidian';
import type { ItineraryHost, TabState } from './model';
import { ItemView } from 'obsidian';
import { mount, unmount } from 'svelte';
import { noteName } from '../../config/paths';
import { filled } from '../../config/validation';
import ItineraryView from './ItineraryView.svelte';

export const VIEW_TYPE_TRAVEL_ITINERARY = 'travel-trip-itinerary';
export class TravelItineraryView extends ItemView {
  private component: ReturnType<typeof mount> | undefined;
  private tripPath = '';
  constructor(leaf: WorkspaceLeaf, private host: ItineraryHost) { super(leaf); }
  getViewType(): string { return VIEW_TYPE_TRAVEL_ITINERARY; }
  getDisplayText(): string {
    const name = noteName(this.tripPath);
    return filled(name)
      ? `Itinerary: ${name}`
      : 'Trip itinerary';
  }

  getIcon(): string { return 'calendar-days'; }
  getState(): Record<string, unknown> { return { tripPath: this.tripPath }; }
  async setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
    this.tripPath = typeof state.tripPath === 'string'
      ? state.tripPath
      : '';
    await this.render();
    await super.setState(state, result);
    this.refreshTitle();
  }

  /** Undocumented; without it the tab and view header keep the title from before the trip was known. */
  private refreshTitle(): void {
    (this.leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.();
    (this as { titleEl?: HTMLElement }).titleEl?.setText(this.getDisplayText());
  }

  async onOpen(): Promise<void> { await this.render(); }
  private async render(): Promise<void> {
    if (this.component)
      await unmount(this.component);
    this.contentEl.empty();
    this.contentEl.addClass('travel-planner');
    this.component = mount(ItineraryView, {
      target: this.contentEl,
      props: {
        host: this.host,
        initialPath: this.tripPath,
        stateChanged: ({ path }: TabState) => {
          const renamed = path !== this.tripPath;
          this.tripPath = path;
          this.app.workspace.requestSaveLayout();
          if (renamed)
            this.refreshTitle();
        },
      },
    });
  }

  async onClose(): Promise<void> {
    if (this.component)
      await unmount(this.component);
    this.component = undefined;
  }
}
