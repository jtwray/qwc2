/**
 * Copyright 2017-2021 Sourcepole AG
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import PropTypes from 'prop-types';
import classnames from 'classnames';
import {connect} from 'react-redux';
import {Rnd} from 'react-rnd';
import {v1 as uuidv1} from 'uuid';
import {raiseWindow, registerWindow, unregisterWindow, setSplitScreen} from '../actions/windows';
import ConfigUtils from '../utils/ConfigUtils';
import LocaleUtils from '../utils/LocaleUtils';
import Icon from './Icon';
import './style/ResizeableWindow.css';

const WINDOW_GEOMETRIES = {};

class ResizeableWindow extends React.Component {
    static propTypes = {
        children: PropTypes.oneOfType([PropTypes.node, PropTypes.func]),
        dockable: PropTypes.oneOfType([PropTypes.bool, PropTypes.string]),
        extraControls: PropTypes.arrayOf(PropTypes.shape({
            active: PropTypes.bool,
            icon: PropTypes.string.isRequired,
            callback: PropTypes.func.isRequired,
            msgid: PropTypes.string
        })),
        icon: PropTypes.string,
        initialHeight: PropTypes.number,
        initialWidth: PropTypes.number,
        initialX: PropTypes.number,
        initialY: PropTypes.number,
        initiallyDocked: PropTypes.bool,
        maxHeight: PropTypes.number,
        maxWidth: PropTypes.number,
        maximizeable: PropTypes.bool,
        minHeight: PropTypes.number,
        minWidth: PropTypes.number,
        minimizeable: PropTypes.bool,
        onClose: PropTypes.func,
        onGeometryChanged: PropTypes.func,
        raiseWindow: PropTypes.func,
        registerWindow: PropTypes.func,
        scrollable: PropTypes.bool,
        setSplitScreen: PropTypes.func,
        splitScreenWhenDocked: PropTypes.bool,
        title: PropTypes.string,
        titlelabel: PropTypes.string,
        unregisterWindow: PropTypes.func,
        visible: PropTypes.bool,
        windowStacking: PropTypes.array
    };
    static defaultProps = {
        initialX: null,
        initialY: null,
        initialWidth: 240,
        initialHeight: 320,
        minWidth: 50,
        minHeight: 50,
        maxWidth: null,
        maxHeight: null,
        maximizeable: true,
        minimizeable: false,
        visible: true,
        dockable: true,
        onGeometryChanged: () => {}
    };
    state = {
        geometry: null
    };
    constructor(props) {
        super(props);
        this.rnd = null;
        this.dragShield = null;
        this.titlebar = null;
        this.id = uuidv1();
        const height = Math.min(props.initialHeight, window.innerHeight - 100);
        const width = Math.min(props.initialWidth, window.innerWidth);
        if (WINDOW_GEOMETRIES[props.title]) {
            this.state.geometry = WINDOW_GEOMETRIES[props.title];
        } else {
            this.state.geometry = {
                x: props.initialX !== null ? this.computeInitialX(props.initialX) : Math.max(0, Math.round(0.5 * (window.innerWidth - width))),
                y: props.initialY !== null ? this.computeInitialY(props.initialY) : Math.max(0, Math.round(0.5 * (window.innerHeight - height))),
                width: width,
                height: height,
                docked: false
            };
        }
        if (props.initiallyDocked) {
            this.state.geometry.docked = true;
        }
        if (props.splitScreenWhenDocked && this.state.geometry.docked) {
            const dockSide = props.dockable === true ? "left" : props.dockable;
            const dockSize = ["left", "right"].includes(dockSide) ? this.state.geometry.width : this.state.geometry.height;
            props.setSplitScreen(this.id, dockSide, dockSize);
        }
    }
    computeInitialX = (x) => {
        return x >= 0 ? x : window.innerWidth - Math.abs(x);
    };
    computeInitialY = (y) => {
        return y >= 0 ? y : window.innerHeight - Math.abs(y);
    };
    componentDidMount() {
        this.props.registerWindow(this.id);
        this.props.onGeometryChanged(this.state.geometry);
    }
    componentWillUnmount() {
        this.props.unregisterWindow(this.id);
        if (this.props.splitScreenWhenDocked) {
            this.props.setSplitScreen(this.id, null);
        }
    }
    componentDidUpdate(prevProps, prevState) {
        if (this.rnd && this.props.visible && this.props.visible !== prevProps.visible) {
            this.rnd.updatePosition(this.state.geometry);
        }
        if (this.props.splitScreenWhenDocked && this.props.visible !== prevProps.visible && this.state.geometry.docked) {
            if (this.props.visible) {
                const dockSide = this.props.dockable === true ? "left" : this.props.dockable;
                const dockSize = ["left", "right"].includes(dockSide) ? this.state.geometry.width : this.state.geometry.height;
                this.props.setSplitScreen(this.id, dockSide, dockSize);
            } else {
                this.props.setSplitScreen(this.id, null);
            }
        }
        if (this.state.geometry !== prevState.geometry) {
            this.props.onGeometryChanged(this.state.geometry);
            if (this.props.title) {
                WINDOW_GEOMETRIES[this.props.title] = this.state.geometry;
            }
            if (this.props.splitScreenWhenDocked) {
                if (this.state.geometry.docked === false && prevState.geometry.docked !== false) {
                    this.props.setSplitScreen(this.id, null);
                } else if (this.state.geometry.docked) {
                    const dockSide = this.props.dockable === true ? "left" : this.props.dockable;
                    const dockSize = ["left", "right"].includes(dockSide) ? this.state.geometry.width : this.state.geometry.height;
                    this.props.setSplitScreen(this.id, dockSide, dockSize);
                }
            }
        }
    }
    renderRole = (role) => {
        return React.Children.toArray(this.props.children).filter((child) => child.props.role === role);
    };
    stopEvent = (ev) => {
        ev.stopPropagation();
    };
    onClose = (ev) => {
        this.props.onClose();
        ev.stopPropagation();
    };
    render() {
        let dockable = this.props.dockable;
        if (ConfigUtils.getConfigProp("globallyDisableDockableDialogs")) {
            dockable = false;
        }
        let maximizeable = this.props.maximizeable;
        if (ConfigUtils.getConfigProp("globallyDisableMaximizeableDialogs")) {
            maximizeable = false;
        }
        let icon = null;
        if (this.props.icon) {
            icon = (<Icon className="resizeable-window-titlebar-icon" icon={this.props.icon} size="large" />);
        }
        const bodyclasses = classnames({
            "resizeable-window-body": true,
            "resizeable-window-nodrag": true,
            "resizeable-window-body-scrollable": this.props.scrollable,
            "resizeable-window-body-nonscrollable": !this.props.scrollable
        });
        const style = {display: this.props.visible ? 'initial' : 'none'};
        const maximized = this.state.geometry.maximized ? true : false;
        const minimized = this.state.geometry.minimized ? true : false;
        const zIndex = 10 + this.props.windowStacking.findIndex(item => item === this.id);
        const docked = this.state.geometry.docked;
        const dockSide = this.props.dockable === true ? "left" : this.props.dockable;
        let dockIcon = docked ? 'undock' : 'dock';
        dockIcon = dockIcon + "_" + dockSide;

        const content = [
            (<div className="resizeable-window-titlebar" key="titlebar" onDoubleClick={this.toggleMaximize} ref={el => { this.titlebar = el; }}>
                {icon}
                <span className="resizeable-window-titlebar-title">
                    {this.props.title ? LocaleUtils.tr(this.props.title) : (this.props.titlelabel || "")}
                </span>
                <span className="resizeable-window-titlebar-extra-controls">
                    {(this.props.extraControls || []).map(entry => {
                        const iconClasses = classnames({
                            "resizeable-window-nodrag": true,
                            "resizeable-window-titlebar-extra-control": true,
                            "resizeable-window-titlebar-extra-control-active": entry.active
                        });
                        return (
                            <Icon
                                className={iconClasses} icon={entry.icon} key={entry.icon}
                                onClick={entry.callback} titlemsgid={entry.msgid ? LocaleUtils.trmsg(entry.msgid) : ""} />
                        );
                    })}
                </span>
                {!maximized && dockable ? (
                    <Icon
                        className="resizeable-window-nodrag resizeable-window-titlebar-control" icon={dockIcon}
                        onClick={this.toggleDock}
                        titlemsgid={this.state.geometry.docked ? LocaleUtils.trmsg("window.undock") : LocaleUtils.trmsg("window.dock")} />
                ) : null}
                {this.props.minimizeable ? (<Icon className="resizeable-window-nodrag resizeable-window-titlebar-control" icon={minimized ? "unminimize" : "minimize"} onClick={this.toggleMinimize} titlemsgid={minimized ? LocaleUtils.trmsg("window.unminimize") : LocaleUtils.trmsg("window.minimize")} />) : null}
                {maximizeable ? (<Icon className="resizeable-window-nodrag resizeable-window-titlebar-control" icon={maximized ? "unmaximize" : "maximize"} onClick={this.toggleMaximize} titlemsgid={maximized ? LocaleUtils.trmsg("window.unmaximize") : LocaleUtils.trmsg("window.maximize")} />) : null}
                {this.props.onClose ? (<Icon className="resizeable-window-nodrag resizeable-window-titlebar-control" icon="remove" onClick={this.onClose} titlemsgid={LocaleUtils.trmsg("window.close")} />) : null}
            </div>),
            (<div className={bodyclasses} key="body" onMouseDown={(ev) => { this.stopEvent(ev); this.props.raiseWindow(this.id); }} onMouseUp={this.stopEvent} onTouchStart={this.stopEvent}>
                <div className="resizeable-window-drag-shield" ref={el => {this.dragShield = el;}} />
                {this.renderRole("body")}
            </div>)
        ];

        const windowclasses = classnames({
            "resizeable-window": true,
            "resizeable-window-maximized": this.state.geometry.maximized,
            "resizeable-window-minimized": this.state.geometry.minimized,
            "resizeable-window-docked-left": !this.props.splitScreenWhenDocked && this.state.geometry.docked && dockSide === "left" && !this.state.geometry.maximized,
            "resizeable-window-docked-right": !this.props.splitScreenWhenDocked && this.state.geometry.docked && dockSide === "right" && !this.state.geometry.maximized,
            "resizeable-window-split-left": this.props.splitScreenWhenDocked && this.state.geometry.docked && dockSide === "left" && !this.state.geometry.maximized,
            "resizeable-window-split-right": this.props.splitScreenWhenDocked && this.state.geometry.docked && dockSide === "right" && !this.state.geometry.maximized,
            "resizeable-window-docked-top": this.state.geometry.docked && dockSide === "top" && !this.state.geometry.maximized,
            "resizeable-window-docked-bottom": this.state.geometry.docked && dockSide === "bottom" && !this.state.geometry.maximized
        });
        let resizeMode = {
            left: true,
            right: true,
            top: true,
            bottom: true,
            bottomLeft: true,
            bottomRight: true,
            topLeft: true,
            topRight: true
        };
        if (this.state.geometry.maximized || this.state.geometry.minimized) {
            resizeMode = false;
        } else if (this.state.geometry.docked) {
            resizeMode = {
                left: dockSide === "right",
                right: dockSide === "left",
                top: dockSide === "bottom",
                bottom: (dockSide !== "bottom" && !this.props.splitScreenWhenDocked) || (this.props.splitScreenWhenDocked && dockSide === "top")
            };
        }
        return (
            <div className="resizeable-window-container" style={style}>
                <Rnd bounds="parent" cancel=".resizeable-window-nodrag"
                    className={windowclasses} default={this.state.geometry}
                    disableDragging={this.state.geometry.maximized || this.state.geometry.docked}
                    enableResizing={resizeMode}
                    maxHeight={this.props.maxHeight || window.innerHeight} maxWidth={this.props.maxWidth || window.innerWidth}
                    minHeight={this.props.minHeight} minWidth={this.props.minWidth}
                    onDragStart={this.onDragStart}
                    onDragStop={this.onDragStop}
                    onMouseDown={() => this.props.raiseWindow(this.id)}
                    onResizeStop={this.onResizeStop}
                    ref={c => { this.rnd = c; }} style={{zIndex: zIndex}}>
                    {content}
                </Rnd>
            </div>
        );
    }
    onDragStart = () => {
        if (this.dragShield) {
            this.dragShield.style.display = 'initial';
        }
    };
    onDragStop = (ev, data) => {
        this.setState((state) => ({
            geometry: {...state.geometry, x: data.x, y: data.y}
        }));
        if (this.dragShield) {
            this.dragShield.style.display = 'none';
        }
    };
    onResizeStop = (ev, dir, ref, delta, position) => {
        this.setState((state) => ({
            geometry: {
                ...state.geometry,
                x: position.x,
                y: position.y,
                width: state.geometry.width + delta.width,
                height: state.geometry.height + delta.height
            }
        }));
    };
    toggleDock = () => {
        this.setState((state) => ({
            geometry: {
                ...state.geometry,
                docked: !state.geometry.docked
            }
        }));
        this.rnd.updatePosition(this.state.geometry);
    };
    toggleMinimize = () => {
        this.setState((state) => ({
            geometry: {
                ...state.geometry,
                minimized: !state.geometry.minimized
            }
        }));
    };
    toggleMaximize = () => {
        this.setState((state) => ({
            geometry: {
                ...state.geometry,
                maximized: !state.geometry.maximized,
                minimized: false
            }
        }));
    };
}

export default connect((state) => ({
    windowStacking: state.windows.stacking
}), {
    raiseWindow: raiseWindow,
    registerWindow: registerWindow,
    setSplitScreen: setSplitScreen,
    unregisterWindow: unregisterWindow
})(ResizeableWindow);
