import type {Bounds, Coordinate} from "./bounds.js";
import type {Diagram} from "./diagram.js";
import type {Id} from "./element.js";
import type {PortAlignment} from "./port.js";

export type NodePlacement = {
    bounds: Bounds;
};

export interface PortPlacement {
    alignment: PortAlignment;
    /**
     * Percentage of the edge wide where the port center is located, counting
     * from left or top. For example, 50 for the top-oriented is the center of
     * the top edge.
     */
    edgePosRatio: number;
}

export const defaultLinkPlacement: LinkPlacement = {};

export interface LinkPlacement {
    // Reserved for future fields (link routing customisation).
}

export interface LinkRender {
    svgPath: string[];
    bounds: Bounds;
    sourcePoint: Coordinate;
    targetPoint: Coordinate;
}

export type PortRender = {
    bounds: Bounds;
};

export type NodeId = Id;
export type PortId = Id;
export type LinkId = Id;

export interface StructureDiagramState extends Diagram {
    nodes: { [id: NodeId]: NodePlacement };
    ports: { [id: PortId]: PortPlacement };
    links: { [id: LinkId]: LinkPlacement };
}
