/**
 * Copyright 2017-2021 Sourcepole AG
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

import ol from 'openlayers';
import axios from 'axios';
import deepmerge from 'deepmerge';
import isEmpty from 'lodash.isempty';
import {XMLParser} from 'fast-xml-parser';
import randomColor from 'randomcolor';
import url from 'url';
import ConfigUtils from './ConfigUtils';
import CoordinatesUtils from './CoordinatesUtils';
import LayerUtils from './LayerUtils';
import MiscUtils from './MiscUtils';
import {LayerRole} from '../actions/layers';

function strcmp(a, b) {
    const al = a.toLowerCase();
    const bl = b.toLowerCase();
    if (al < bl) {
        return -1;
    } else if (al > bl) {
        return 1;
    }
    return 0;
}

function array(obj) {
    return Array.isArray(obj) ? obj : [obj];
}

const ServiceLayerUtils = {
    getDCPTypes(dcpTypes) {
        let result = {};
        for (const dcpType of dcpTypes) {
            result = deepmerge(result, dcpType);
        }
        return result;
    },
    getWMTSLayers(capabilitiesXml, capabilitiesUrl, mapCrs) {
        const wmtsFormat = new ol.format.WMTSCapabilities();
        const capabilities = wmtsFormat.read(capabilitiesXml);
        const tileMatrices = capabilities.Contents.TileMatrixSet.reduce((res, entry) => {
            const crsMatch = entry.SupportedCRS.match(/(EPSG).*:(\d+)/i);
            res[entry.Identifier] = {
                crs: crsMatch ? "EPSG:" + crsMatch[2] : entry.SupportedCRS,
                matrix: entry.TileMatrix
            };
            return res;
        }, {});
        const layers = capabilities.Contents.Layer.map(layer => {
            const matchingMatrix = layer.TileMatrixSetLink.find(link => tileMatrices[link.TileMatrixSet].crs === mapCrs);
            const tileMatrixSet = matchingMatrix ? matchingMatrix.TileMatrixSet : layer.TileMatrixSetLink[0].TileMatrixSet;
            const topMatrix = tileMatrices[tileMatrixSet].matrix[0];
            let origin = [topMatrix.TopLeftCorner[0], topMatrix.TopLeftCorner[1]];
            try {
                const axisOrder = CoordinatesUtils.getAxisOrder(tileMatrices[tileMatrixSet].crs).substr(0, 2);
                if (axisOrder  === 'ne') {
                    origin = [topMatrix.TopLeftCorner[1], topMatrix.TopLeftCorner[0]];
                }
            } catch (e) {
                // eslint-disable-next-line
                console.warn("Could not determine axis order for projection " + tileMatrices[tileMatrixSet].crs);
                return null;
            }
            const resolutions = tileMatrices[tileMatrixSet].matrix.map(entry => {
                // 0.00028: assumed pixel width in meters, as per WMTS standard
                return entry.ScaleDenominator * 0.00028;
            });
            const styles = MiscUtils.ensureArray(layer.Style || []);
            const style = (styles.find(entry => entry.isDefault) || styles[0] || {Identifier: ""}).Identifier;
            const getTile = MiscUtils.ensureArray(capabilities.OperationsMetadata.GetTile.DCP.HTTP.Get)[0];
            const getEncoding = MiscUtils.ensureArray(getTile.Constraint).find(c => c.name === "GetEncoding");
            const requestEncoding = MiscUtils.ensureArray(getEncoding.AllowedValues.Value)[0];
            let serviceUrl = null;
            if (requestEncoding === 'KVP') {
                serviceUrl = getTile.href;
            } else {
                serviceUrl = layer.ResourceURL.find(u => u.resourceType === "tile").template;
                (layer.Dimension || []).forEach(dim => {
                    serviceUrl = serviceUrl.replace("{" + dim.Identifier + "}", dim.Default);
                });
            }
            return {
                type: "wmts",
                url: serviceUrl,
                capabilitiesUrl: capabilitiesUrl,
                title: layer.Title,
                name: layer.Identifier,
                tileMatrixPrefix: "",
                tileMatrixSet: tileMatrixSet,
                originX: origin[0],
                originY: origin[1],
                projection: tileMatrices[tileMatrixSet].crs,
                tileSize: [
                    topMatrix.TileWidth,
                    topMatrix.TileHeight
                ],
                style: style,
                bbox: {
                    crs: "EPSG:4326",
                    bounds: layer.WGS84BoundingBox
                },
                format: MiscUtils.ensureArray(layer.Format)[0],
                requestEncoding: requestEncoding,
                resolutions: resolutions,
                abstract: layer.Abstract,
                attribution: {
                    Title: capabilities.ServiceProvider?.ProviderName || capabilities.ServiceIdentification?.Title || "",
                    OnlineResource: capabilities.ServiceProvider?.ProviderSite || ""
                }
            };
        }).filter(Boolean);
        layers.sort((a, b) => a.title.localeCompare(b.title));
        return layers;
    },
    getWMSLayers(capabilitiesXml, calledServiceUrl, asGroup = false) {
        const wmsFormat = new ol.format.WMSCapabilities();
        const capabilities = wmsFormat.read(capabilitiesXml);
        const calledUrlParts = url.parse(calledServiceUrl, true);
        const extwmsparams = {};
        calledUrlParts.query = Object.keys(calledUrlParts.query).filter(key => {
            // Extract extwms params
            if ( key.startsWith("extwms.") ) {
                extwmsparams[key.substring(7)] = calledUrlParts.query[key];
                return false;
            }
            // Filter service and request from calledServiceUrl, but keep other parameters (i.e. MAP)
            return !["service", "request"].includes(key.toLowerCase());
        }).reduce((res, key) => ({...res, [key]: calledUrlParts.query[key]}), {});
        delete calledUrlParts.search;

        const topLayer = capabilities.Capability.Layer;

        const getMapUrl = this.mergeCalledServiceUrlQuery(ServiceLayerUtils.getDCPTypes(capabilities.Capability.Request.GetMap.DCPType).HTTP.Get.OnlineResource, calledUrlParts);
        let featureInfoUrl = getMapUrl;
        try {
            featureInfoUrl = this.mergeCalledServiceUrlQuery(ServiceLayerUtils.getDCPTypes(capabilities.Capability.Request.GetFeatureInfo.DCPType).HTTP.Get.OnlineResource, calledUrlParts);
        } catch (e) {
            // pass
        }
        let infoFormats = null;
        try {
            infoFormats = capabilities.Capability.Request.GetFeatureInfo.Format;
        } catch (e) {
            infoFormats = ['text/plain'];
        }
        const externalLayerFeatureInfoFormats = ConfigUtils.getConfigProp("externalLayerFeatureInfoFormats") || {};
        for (const entry of Object.keys(externalLayerFeatureInfoFormats)) {
            if (featureInfoUrl.toLowerCase().includes(entry.toLowerCase())) {
                infoFormats = [externalLayerFeatureInfoFormats[entry]];
                break;
            }
        }
        const version = capabilities.version;
        if (!topLayer.Layer || asGroup) {
            return [this.getWMSLayerParams(topLayer, topLayer.CRS, calledUrlParts, version, getMapUrl, featureInfoUrl, infoFormats, extwmsparams)].filter(entry => entry);
        } else {
            const entries = topLayer.Layer.map(layer => this.getWMSLayerParams(layer, topLayer.CRS, calledUrlParts, version, getMapUrl, featureInfoUrl, infoFormats, extwmsparams)).filter(entry => entry);
            return entries.sort((a, b) => strcmp(a.title, b.title));
        }
    },
    getWMSLayerParams(layer, parentCrs, calledUrlParts, version, getMapUrl, featureInfoUrl, infoFormats, extwmsparams, groupbbox = null) {
        let supportedCrs = layer.CRS;
        if (isEmpty(supportedCrs)) {
            supportedCrs = [...(parentCrs || [])];
        } else {
            supportedCrs = [...(parentCrs || []), ...supportedCrs];
        }
        let sublayers = [];
        const sublayerbounds = {};
        if (!isEmpty(layer.Layer)) {
            sublayers = layer.Layer.map(sublayer => this.getWMSLayerParams(sublayer, supportedCrs, calledUrlParts, version, getMapUrl, featureInfoUrl, infoFormats, extwmsparams, sublayerbounds)).filter(entry => entry);
        }
        let bbox = null;
        if (isEmpty(layer.BoundingBox)) {
            if (isEmpty(sublayerbounds)) {
                return null;
            } else {
                bbox = sublayerbounds;
            }
        } else {
            bbox = {
                crs: layer.BoundingBox[0].crs,
                bounds: layer.BoundingBox[0].extent
            };
        }
        if (groupbbox !== null) {
            if (isEmpty(groupbbox)) {
                Object.assign(groupbbox, bbox);
            } else if (bbox.crs === groupbbox.crs) {
                groupbbox.bounds[0] = Math.min(bbox.bounds[0], groupbbox.bounds[0]);
                groupbbox.bounds[1] = Math.min(bbox.bounds[1], groupbbox.bounds[1]);
                groupbbox.bounds[2] = Math.max(bbox.bounds[2], groupbbox.bounds[2]);
                groupbbox.bounds[3] = Math.max(bbox.bounds[3], groupbbox.bounds[3]);
            }
        }
        let legendUrl = getMapUrl;
        try {
            legendUrl = this.mergeCalledServiceUrlQuery(layer.Style[0].LegendURL[0].OnlineResource, calledUrlParts);
        } catch (e) {
            /* pass */
        }
        return {
            type: "wms",
            name: layer.Name,
            title: layer.Title,
            abstract: layer.Abstract,
            attribution: layer.Attribution,
            url: getMapUrl,
            featureInfoUrl: featureInfoUrl,
            legendUrl: legendUrl,
            version: version,
            infoFormats: infoFormats,
            queryable: layer.queryable,
            sublayers: isEmpty(sublayers) ? null : sublayers,
            expanded: false,
            bbox: bbox,
            visibility: true,
            opacity: 255,
            extwmsparams: extwmsparams,
            minScale: layer.MinScaleDenominator,
            maxScale: layer.MaxScaleDenominator
        };
    },
    mergeCalledServiceUrlQuery(capabilityUrl, calledServiceUrlParts) {
        if (ConfigUtils.getConfigProp("trustWmsCapabilityURLs")) {
            return url.format(calledServiceUrlParts);
        }
        try {
            const urlParts = url.parse(capabilityUrl, true);
            urlParts.host = calledServiceUrlParts.host;
            urlParts.protocol = calledServiceUrlParts.protocol ?? location.protocol;
            urlParts.query = {...calledServiceUrlParts.query, ...urlParts.query};
            delete urlParts.search;
            return url.format(urlParts);
        } catch (e) {
            return url.format(calledServiceUrlParts);
        }
    },
    getWFSLayers(capabilitiesXml, calledServiceUrl, mapCrs) {
        const calledUrlParts = url.parse(calledServiceUrl, true);
        // Filter service and request from calledServiceUrl, but keep other parameters (i.e. MAP)
        calledUrlParts.query = Object.keys(calledUrlParts.query).filter(key => {
            return !["service", "request"].includes(key.toLowerCase());
        }).reduce((res, key) => ({...res, [key]: calledUrlParts.query[key]}), {});
        delete calledUrlParts.search;

        const options = {
            attributeNamePrefix: "",
            ignoreAttributes: false,
            parseTagValue: true,
            parseAttributeValue: true,
            removeNSPrefix: true
        };
        const capabilities = (new XMLParser(options)).parse(capabilitiesXml);
        if (!capabilities || !capabilities.WFS_Capabilities || !capabilities.WFS_Capabilities.version) {
            return [];
        } else if (capabilities.WFS_Capabilities.version < "1.1.0") {
            return ServiceLayerUtils.getWFS10Layers(capabilities.WFS_Capabilities, calledUrlParts);
        } else {
            return ServiceLayerUtils.getWFS11_20Layers(capabilities.WFS_Capabilities, calledUrlParts, mapCrs);
        }
    },
    getWFS10Layers(capabilities, calledUrlParts) {
        let serviceUrl = null;
        const version = capabilities.version;
        let formats = null;
        try {
            serviceUrl = ServiceLayerUtils.getDCPTypes(array(capabilities.Capability.Request.GetFeature.DCPType)).HTTP.Get.onlineResource;
            serviceUrl = this.mergeCalledServiceUrlQuery(serviceUrl, calledUrlParts);
            formats = Object.keys(capabilities.Capability.Request.GetFeature.ResultFormat);
            if (typeof(formats) === 'string') {
                // convert to list if single entry
                formats = [formats];
            }
        } catch (e) {
            return [];
        }

        const layers = [];
        for (const featureType of array(capabilities.FeatureTypeList.FeatureType)) {
            let name;
            let bbox;
            try {
                name = featureType.Name;
                const llbbox = featureType.LatLongBoundingBox;
                bbox = {
                    crs: featureType.SRS,
                    bounds: [llbbox.minx, llbbox.miny, llbbox.maxx, llbbox.maxy]
                };
            } catch (e) {
                continue; // Name and bbox are required
            }
            const title = featureType.Title || name;
            const abstract = featureType.Abstract || "";

            layers.push({
                type: "wfs",
                name: name,
                title: title,
                abstract: abstract,
                bbox: bbox,
                projection: featureType.SRS,
                url: serviceUrl,
                version: version,
                formats: formats,
                color: randomColor(),
                visibility: true
            });
        }
        return layers;
    },
    getWFS11_20Layers(capabilities, calledUrlParts, mapCrs) {
        let serviceUrl = null;
        const version = capabilities.version;
        let formats = null;
        try {
            const getFeatureOp = array(capabilities.OperationsMetadata.Operation).find(el => el.name === "GetFeature");
            serviceUrl = ServiceLayerUtils.getDCPTypes(array(getFeatureOp.DCP)).HTTP.Get.href;
            serviceUrl = this.mergeCalledServiceUrlQuery(serviceUrl, calledUrlParts);
            const outputFormat = array(getFeatureOp.Parameter).find(el => el.name === "outputFormat");
            formats = MiscUtils.ensureArray(outputFormat.AllowedValues ? outputFormat.AllowedValues.Value : outputFormat.Value);
        } catch (e) {
            return [];
        }

        const layers = [];
        for (const featureType of array(capabilities.FeatureTypeList.FeatureType)) {
            let name;
            let bbox;
            try {
                name = featureType.Name;
                const lc = featureType.WGS84BoundingBox.LowerCorner.split(/\s+/);
                const uc = featureType.WGS84BoundingBox.UpperCorner.split(/\s+/);
                bbox = {
                    crs: "EPSG:4326",
                    bounds: [lc[0], lc[1], uc[0], uc[1]]
                };
            } catch (e) {
                continue; // Name and bbox are required
            }
            const title = featureType.Title || name;
            const abstract = featureType.Abstract || "";
            const projections = [
                CoordinatesUtils.fromOgcUrnCrs(featureType.DefaultCRS || featureType.DefaultSRS),
                ...MiscUtils.ensureArray(featureType.OtherCRS || featureType.OtherSRS || []).map(crs => CoordinatesUtils.fromOgcUrnCrs(crs))
            ];
            const projection = projections.includes(mapCrs) ? mapCrs : projections[0];

            layers.push({
                type: "wfs",
                name: name,
                title: title,
                abstract: abstract,
                bbox: bbox,
                projection: projection,
                url: serviceUrl,
                version: version,
                formats: formats,
                color: randomColor(),
                visibility: true
            });
        }
        return layers;
    },
    findLayers(type, serviceUrl, layerConfigs, mapCrs, callback) {
        // Scan the capabilities of the specified service for the specified layers
        serviceUrl = MiscUtils.adjustProtocol(serviceUrl).replace(/\?$/, '');
        if (type === "wmts") {
            // Do nothing
        } else if (serviceUrl.includes('?')) {
            serviceUrl += "&service=" + type.toUpperCase() + "&request=GetCapabilities";
        } else {
            serviceUrl += "?service=" + type.toUpperCase() + "&request=GetCapabilities";
        }
        axios.get(serviceUrl).then(response => {
            for (const layerConfig of layerConfigs) {
                let result = null;
                if (type === "wms") {
                    result = ServiceLayerUtils.getWMSLayers(response.data, serviceUrl, true);
                } else if (type === "wfs") {
                    result = ServiceLayerUtils.getWFSLayers(response.data, serviceUrl, mapCrs);
                } else if (type === "wmts") {
                    result = ServiceLayerUtils.getWMTSLayers(response.data, serviceUrl, mapCrs);
                }
                let layer = LayerUtils.searchSubLayer({sublayers: result}, "name", layerConfig.name);
                // Some services (i.e. wms.geo.admin.ch) have same-named sublayers
                layer = LayerUtils.searchSubLayer(layer, "name", layerConfig.name) ?? layer;
                if (layer) {
                    layer = {
                        ...layer,
                        id: layerConfig.id,
                        opacity: layerConfig.opacity,
                        visibility: layerConfig.visibility,
                        role: LayerRole.USERLAYER
                    };
                    callback(layerConfig.id, layer);
                } else {
                    // eslint-disable-next-line
                    console.warn("Could not find layer " + layerConfig.name);
                    callback(layerConfig.id, null);
                }
            }
        }).catch(() => {
            // eslint-disable-next-line
            console.warn("Failed to read " + serviceUrl);
            for (const layerConfig of layerConfigs) {
                callback(layerConfig.id, null);
            }
        });
    }
};

export default ServiceLayerUtils;
