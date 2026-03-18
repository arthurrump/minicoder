import type { Component } from 'solid-js';

interface OcticonIcon {
    toSVG(options?: Record<string, unknown>): string;
}

interface IconProps {
    icon: OcticonIcon;
    width?: number;
    class?: string;
}

const Icon: Component<IconProps> = (props) => {
    const svg = () => {
        const opts: Record<string, unknown> = {};
        if (props.width !== undefined) opts.width = props.width;
        return props.icon.toSVG(opts);
    };

    // eslint-disable-next-line solid/no-innerhtml
    return <span class={props.class} innerHTML={svg()} />;
};

export default Icon;
