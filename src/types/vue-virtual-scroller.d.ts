declare module 'vue-virtual-scroller' {
  import { DefineComponent } from 'vue';
  
  export interface RecycleScrollerProps {
    items: any[];
    itemSize?: number | null;
    keyField?: string;
    buffer?: number;
    pageMode?: boolean;
    prerender?: number;
    emitUpdate?: boolean;
    sizeField?: string;
    typeField?: string;
  }
  
  export const RecycleScroller: DefineComponent<RecycleScrollerProps>;
  export const DynamicScroller: DefineComponent<any>;
  export const DynamicScrollerItem: DefineComponent<any>;
}
