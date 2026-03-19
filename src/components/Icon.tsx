import type { Component } from 'solid-js';
import octicons from '@primer/octicons';

type IconName = keyof typeof octicons;

interface IconProps {
    name: IconName;
    width?: number;
    class?: string;
}

const Icon: Component<IconProps> = (props) => {
    const svg = () => {
        const opts: Record<string, unknown> = {};
        if (props.width !== undefined) opts.width = props.width;
        return octicons[props.name].toSVG(opts);
    };

    // eslint-disable-next-line solid/no-innerhtml
    return <span class={props.class} innerHTML={svg()} />;
};

export default Icon;
