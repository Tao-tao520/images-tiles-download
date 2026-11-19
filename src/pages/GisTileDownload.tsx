import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '@mui/material/styles';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import Map from 'ol/Map';
import XYZ from 'ol/source/XYZ';
import TileLayer from 'ol/layer/Tile';
import View from 'ol/View';
import Graticule from 'ol/layer/Graticule.js';
import Stroke from 'ol/style/Stroke.js';
import {fromLonLat, toLonLat, transformExtent} from 'ol/proj.js';
import "ol/ol.css";
import { Alert, Box, Button, Grid2 as Grid, IconButton, MenuItem, Paper, Select, SelectChangeEvent, Slide, Slider, Snackbar, Stack, TextField, Tooltip, Typography } from '@mui/material';
import streamSaver from 'streamsaver';
import Draw, { createBox } from 'ol/interaction/Draw';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Polygon, { fromExtent } from 'ol/geom/Polygon';
import GeoJSON from 'ol/format/GeoJSON';
import { Coordinate } from 'ol/coordinate';
import ProgressDialog from '../components/ProgressDialog';
import { Feature } from 'ol';
import { useTranslation } from 'react-i18next';
import { CreateTarDataBlock, CreateTarEndBlock, CreateTarHeaderBlock } from '../features/Tar';
import * as mime from 'mime-types'


type DownloadHandler = (x:number, y:number, z:number, response:Response)=>Promise<void>;
type ErrorHandler = (x:number, y:number, z:number, error:any)=>Promise<void>;
class XYZDownloader {
    url: string;
    max: number;
    private active = 0;
    private running = 0;
    private waiters: Array<() => void> = [];
    private idleWaiters: Array<() => void> = [];

    constructor(url:string, max: number) {
        this.url = url;
        this.max = max;
    }

    // Promise 表示全部下载完毕
    done(): Promise<void> {
        if (this.running === 0) {
            return Promise.resolve();
        }
        return new Promise(resolve => {
            this.idleWaiters.push(resolve);
        });
    }

    // Promise 表示任务已占到并发位并开始下载，不是下载完毕
    addTask(x:number, y:number, z:number, callback:DownloadHandler, error:ErrorHandler): Promise<void> {
        this.running++;
        const start = () => {
            this.active++;
            void this.run(x, y, z, callback, error);
        };

        if (this.active < this.max) {
            start();
            return Promise.resolve();
        }

        return new Promise(resolve => {
            this.waiters.push(() => {
                start();
                resolve();
            });
        });
    }

    private async run(x:number, y:number, z:number, callback:DownloadHandler, error:ErrorHandler) {
        const url = this.url.replace('{z}', `${z}`).replace('{x}', `${x}`).replace('{y}', `${y}`);
        try {
            const response = await fetch(url);
            await callback(x, y, z, response);
        } catch (err) {
            await error(x, y, z, err);
        } finally {
            this.active--;
            this.running--;
            const next = this.waiters.shift();
            if (next) {
                next();
            } else if (this.running === 0) {
                const idle = this.idleWaiters.splice(0);
                idle.forEach((resolve) => resolve());
            }
        }
    }
}

interface TileServerProps {
    name: string,
    url: string,
    filter: string,
}

// WGS84(EPSG:3857)
const Proj = {
    radians: (degrees:number) => {
        return degrees * (Math.PI/180);
    },

    longitudeToX: (v:number, zoom:number) => {
        const x = Math.floor(256 / (2 * Math.PI) *  Math.pow(2, zoom) * (Proj.radians(v) + Math.PI)/256);
        return x < Math.pow(2, zoom) ? x : Math.pow(2, zoom) - 1;
    },

    latitudeToY: (v:number, zoom:number) => {
        const y = Math.floor(256 / (2 * Math.PI) * Math.pow(2, zoom) * (Math.PI - Math.log(Math.tan(Math.PI/4 + Proj.radians(v)/2)))/256);
        return y < Math.pow(2, zoom) ? y : Math.pow(2, zoom) - 1;
    }
}

// 判断是否是 GTS URL
const isGisUrl = (text:string) => {
    if (!text.includes("{x}") || !text.includes("{y}") || !text.includes("{z}")) {
        return false;
    }

    try {
        const url = new URL(text);
        if (url.origin === 'null') {
            return false;
        }
    } catch {
        return false;
    }

    return true;
}

// 阿里云 DataV.GeoAtlas 行政区划（areas_v3）
// https://datav.aliyun.com/portal/school/atlas/area_selector
const DATAV_BOUND = "https://geo.datav.aliyun.com/areas_v3/bound";
const CHINA_ADCODE = "100000";
const geoJsonFormat = new GeoJSON();

interface AreaNode {
    adcode: string;
    name: string;
    level: string;
    childrenNum: number;
}

async function fetchAreaNodes(adcode: string): Promise<AreaNode[]> {
    const res = await fetch(`${DATAV_BOUND}/${adcode}_full.json`);
    if (!res.ok) {
        return [];
    }

    const data = await res.json();
    const features = Array.isArray(data?.features) ? data.features : [];
    const nodes: AreaNode[] = [];
    for (const feature of features) {
        const props = feature?.properties;
        const code = String(props?.adcode ?? "");
        if (!props?.name || !/^\d{6}$/.test(code)) {
            continue;
        }
        nodes.push({
            adcode: code,
            name: String(props.name),
            level: String(props.level ?? ""),
            childrenNum: Number(props.childrenNum ?? 0),
        });
    }
    return nodes;
}

function AreaSelect(props: {
    value: string;
    placeholder: string;
    options: AreaNode[];
    disabled?: boolean;
    allowEmpty?: boolean;
    onChange: (adcode: string) => void;
}) {
    return (
        <Select
            fullWidth
            variant="standard"
            displayEmpty
            disabled={props.disabled}
            value={props.value}
            onChange={(ev) => props.onChange(ev.target.value)}
            renderValue={(selected) => props.options.find((item) => item.adcode === selected)?.name ?? props.placeholder}
            sx={{ flex: 1, minWidth: 0, '& .MuiSelect-select': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
        >
            {props.allowEmpty !== false && <MenuItem value="">{props.placeholder}</MenuItem>}
            {props.options.map((item) => (
                <MenuItem key={item.adcode} value={item.adcode}>{item.name}</MenuItem>
            ))}
        </Select>
    );
}

export default function GisTileDownload() {
    // i18n
    const { t } = useTranslation();

    // SEO
    useEffect(() => {
        document.title = t("title");
        document.querySelector('meta[name="description"]')?.setAttribute("content", t("description.gis-tile-download"));
    }, [t]);

    const [tiandituKey, setTiandituKey] = useState(() => localStorage.getItem("tianditu-tk") ?? "");
    
    const servers = useMemo<TileServerProps[]>(() => [
        {
            name: t("gis-tile-download.google-map"),
            url: "https://mt1.google.com/vt/x={x}&y={y}&z={z}",
            filter: 'grayscale(98%) invert(100%) sepia(20%) hue-rotate(180deg) saturate(1600%) brightness(80%) contrast(90%)',
        },

        {
            name: t("gis-tile-download.auto-navi"),
            url: "https://webrd02.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
            filter: 'grayscale(98%) invert(100%) sepia(20%) hue-rotate(180deg) saturate(1600%) brightness(80%) contrast(90%)',
        },

        {
            name: t("gis-tile-download.auto-navi-no-label"),
            url: "https://webst02.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&ltype=3&x={x}&y={y}&z={z}",
            filter: 'grayscale(98%) invert(100%) sepia(20%) hue-rotate(180deg) saturate(1600%) brightness(80%) contrast(90%)',
        },

        {
            name: t("gis-tile-download.arc-gis"),
            url: "https://server.arcgisonline.com/arcgis/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}.png",
            filter: 'grayscale(98%) invert(100%) sepia(20%) hue-rotate(180deg) saturate(1600%) brightness(80%) contrast(90%)',
        },

        {
            name: t("gis-tile-download.osm"),
            url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            filter: 'grayscale(98%) invert(100%) sepia(20%) hue-rotate(180deg) saturate(1600%) brightness(80%) contrast(90%)',
        },

        {
            name: t("gis-tile-download.google-satellite"),
            url: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
            filter: 'none',
        },

        {
            name: t("gis-tile-download.auto-navi-satellite"),
            url: "https://webst01.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}",
            filter: 'none',
        },

        {
            name: t("gis-tile-download.arc-gis-satellite"),
            url: "https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}.png",
            filter: 'none',
        },

        {
            name: t("gis-tile-download.tianditu-vector"),
            url: `https://t0.tianditu.gov.cn/DataServer?T=vec_w&x={x}&y={y}&l={z}&tk=${encodeURIComponent(tiandituKey)}`,
            filter: 'grayscale(98%) invert(100%) sepia(20%) hue-rotate(180deg) saturate(1600%) brightness(80%) contrast(90%)',
        },

        {
            name: t("gis-tile-download.tianditu-image"),
            url: `https://t0.tianditu.gov.cn/DataServer?T=img_w&x={x}&y={y}&l={z}&tk=${encodeURIComponent(tiandituKey)}`,
            filter: 'none',
        },

        {
            name: t("gis-tile-download.tianditu-terrain"),
            url: `https://t0.tianditu.gov.cn/DataServer?T=ter_w&x={x}&y={y}&l={z}&tk=${encodeURIComponent(tiandituKey)}`,
            filter: 'grayscale(98%) invert(100%) sepia(20%) hue-rotate(180deg) saturate(1600%) brightness(80%) contrast(90%)',
        },
    ], [t, tiandituKey]);

    // 选择哪个地图
    const [choice, setChoice] = useState(0);
    const [customUrl, setCustomUrl] = useState("");

    // 风格
    const theme = useTheme();

    const mapStyle = {
        height: "100%",
        width: "100%",
    };

    // 获取用户定位并将地图中心移动到该处
    const locate = () => {
        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition((pos) => {
                mapRef.current?.getView().setCenter(fromLonLat([pos.coords.longitude, pos.coords.latitude]));
            })
        }
    }

    // 显示错误信息
    const [showAlert, setShowAlert] = useState(false);
    const [alertMessage, setAlertMessage] = useState("");
    const closeSnakebar = (_:any, reason:string) => {
        if (reason === 'clickaway') {
            return;
        }

        setShowAlert(false);
    }

    // 选取范围
    const area = useRef<[Coordinate, Coordinate]>([[NaN, NaN],[NaN,NaN]]);
    const [zoomRange, setZoomRange] = useState<number[]>([0, 16]);
    const [mapZoom, setMapZoom] = useState(4);

    // 行政区划：全国 / 省 / 市 / 区
    const [provinces, setProvinces] = useState<AreaNode[]>([]);
    const [cities, setCities] = useState<AreaNode[]>([]);
    const [districts, setDistricts] = useState<AreaNode[]>([]);
    const [countryCode, setCountryCode] = useState("");
    const [provinceCode, setProvinceCode] = useState("");
    const [cityCode, setCityCode] = useState("");
    const [districtCode, setDistrictCode] = useState("");
    const regionToken = useRef(0);

    useEffect(() => {
        let cancelled = false;
        fetchAreaNodes(CHINA_ADCODE).then((nodes) => {
            if (!cancelled) {
                setProvinces(nodes.filter((node) => node.level === "province"));
            }
        }).catch(() => {
            if (!cancelled) {
                setAlertMessage(t("gis-tile-download.message.region-failed"));
                setShowAlert(true);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [t]);

    // 下载图块
    const [progressValue, setProgressValue] = useState(0);
    const [progressMax, setProgressMax] = useState(1);
    const [showProgress, setShowProgress] = useState(false);
    const [concurrency, setConcurrency] = useState(10);
    const downloading = useRef(false);
    const download = async () => {
        const url = choice < servers.length ? servers[choice].url : customUrl;
        const FOLDER_NAME = "maps";
        if (isNaN(area.current[0][0])) {
            setAlertMessage(t("gis-tile-download.message.please-select"));
            setShowAlert(true);
            return;
        }
        downloading.current = true;
        setProgressValue(0);
        setShowProgress(true);

        let total = 0;
        for (let z = zoomRange[0]; z <= zoomRange[1]; z++) {
            total += (Proj.longitudeToX(area.current[1][0], z) - Proj.longitudeToX(area.current[0][0], z) + 1) * (Proj.latitudeToY(area.current[0][1], z) - Proj.latitudeToY(area.current[1][1], z) + 1);
        }
        setProgressMax(total);

        const regionName = districts.find((item) => item.adcode === districtCode)?.name
            || cities.find((item) => item.adcode === cityCode)?.name
            || provinces.find((item) => item.adcode === provinceCode)?.name
            || (countryCode ? t("gis-tile-download.country") : "");
        const zStart = String(zoomRange[0]).padStart(2, "0");
        const zEnd = String(zoomRange[1]).padStart(2, "0");
        const zLabel = zStart === zEnd ? `z${zStart}` : `z${zStart}-${zEnd}`;
        const fileName = `${regionName ? `${regionName}-` : ""}${zLabel}.tar`;
        const fileStream = streamSaver.createWriteStream(fileName);
        const writer = fileStream.getWriter();

        let downloader = new XYZDownloader(url, concurrency);
        let done = 0;
        let progressTimer = 0;
        // 写盘串行，避免并发写乱序；不占用下载并发位
        let writeChain: Promise<void> = Promise.resolve();
        const reportProgress = () => {
            if (progressTimer) {
                return;
            }
            progressTimer = window.setTimeout(() => {
                progressTimer = 0;
                setProgressValue(done);
            }, 200);
        };

        const downloadHandler: DownloadHandler = async (x, y, z, response) => {
            const value = new Uint8Array(await response.arrayBuffer());
            const ext = mime.extension(response.headers.get("content-type") || "image/png") || "png";
            const path = `${FOLDER_NAME}/${z}/${x}/${y}.${ext}`;
            const header = CreateTarHeaderBlock(path, value.length || 0);
            const content = CreateTarDataBlock(value);
            // 写完再释放并发位，避免瓦片全部堆在内存里
            const written = writeChain.then(async () => {
                await writer.write(header);
                await writer.write(content);
            });
            writeChain = written.then(() => undefined, () => undefined);
            await written;
            done++;
            reportProgress();
        }

        const errorHandler: ErrorHandler = async (x, y, z, err) => {
            if (err) {
                setAlertMessage(`${err}`);
                setShowAlert(true);
            } else {
                setAlertMessage(t("gis-tile-download.message.unknown-error"));
                setShowAlert(true);
            }

            // 失败重试。只排队，不能在当前任务里等待，否则并发满时会互相卡住
            if (downloading.current) {
                void downloader.addTask(x, y, z, downloadHandler, errorHandler);
            }
        }

        for (let z = zoomRange[0]; z <= zoomRange[1]; z++) {
            for (let x = Proj.longitudeToX(area.current[0][0], z); x <= Proj.longitudeToX(area.current[1][0], z); x++) {
                for (let y = Proj.latitudeToY(area.current[1][1], z); y <= Proj.latitudeToY(area.current[0][1], z); y++) {

                    // 取消下载
                    if (!downloading.current) {
                        if (progressTimer) {
                            clearTimeout(progressTimer);
                        }
                        writer.abort(t("common.cancel"));
                        setShowProgress(false);
                        return;
                    }
                    
                    await downloader.addTask(x, y, z, downloadHandler, errorHandler);
                }
            }
        }

        await downloader.done();
        await writeChain;
        if (progressTimer) {
            clearTimeout(progressTimer);
        }
        setProgressValue(done);
        await writer.write(CreateTarEndBlock());
        await writer.close();
        setShowProgress(false);
        downloading.current = false;
    }

    const mapDivRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<Map|null>(null);
    const tileLayer = useRef<TileLayer<XYZ>|null>(null);
    const vectorSource = useRef<VectorSource|null>(null);
    const vectorLayer = useRef<VectorLayer|null>(null);
    const filter = useRef('none');

    // 切换明暗模式
    useEffect(() => {
        if (choice < servers.length) {
            filter.current = theme.palette.mode === 'dark' ? servers[choice].filter : 'none';
            mapRef.current?.render();
        }
    }, [theme.palette.mode, servers, choice]);

    // 切换地图服务器选项
    const loading = useRef(0);
    useEffect(() => {
        if (!mapDivRef.current) {
            return;
        }

        const url = choice < servers.length ? servers[choice].url : customUrl;
        const center = mapRef.current?.getView().getCenter() ?? fromLonLat([104.5, 36]);

        if (mapRef.current) {
            if (loading.current > 0) {
                mapRef.current.dispose();
                loading.current = 0;
            } else {
                tileLayer.current?.getSource()?.setUrl(url);
                return;
            }
        }
        
        // 地图块图层
        tileLayer.current = new TileLayer({
            source: new XYZ({  
                url: url,       
                wrapX: true,
            }),
        });

        // 渲染前设置黑暗滤镜
        tileLayer.current?.on('prerender', (ev) => {
            if (ev.context) {
                const ctx = ev.context as CanvasRenderingContext2D;
                ctx.filter = filter.current;
            }
        });

        // 渲染后删除滤镜，避免影响其他图层
        tileLayer.current?.on('postrender', (ev) => {
            if (ev.context) {
                const ctx = ev.context as CanvasRenderingContext2D;
                ctx.filter = 'none';
            }
        });

        // loading 计数
        tileLayer.current?.getSource()?.on('tileloadstart', () => {
            loading.current += 1;
        });

        tileLayer.current?.getSource()?.on('tileloadend', () => {
            loading.current -= 1;
        });

        // 矢量源-用于绘图
        vectorSource.current = new VectorSource();

        // 矢量图层-用于显示矢量源
        vectorLayer.current = new VectorLayer({
            source: vectorSource.current,
        });

        let map = new Map({
            target: mapDivRef.current,

            layers: [
                // 地图图块
                tileLayer.current,

                // 经纬度网格
                new Graticule({
                    strokeStyle: new Stroke({
                        color: 'gray',
                        width: 2,
                        lineDash: [0.5, 4],
                    }),
                    showLabels: true,
                    wrapX: true,
                }),

                // 绘图矢量图层
                vectorLayer.current,
            ],

            view: new View({
                center: center,
                zoom: 4,
            }),
        });

        let draw = new Draw({
            source: vectorSource.current,
            type: "Circle", 
            geometryFunction: createBox(),
            condition: (e) => e.originalEvent.buttons === 1,
        });

        // 清除绘制的图形
        draw.on('drawstart', () => {
            cleanDraw();
        });

        draw.on('drawabort', () => {
            cleanDraw();
        });

        draw.on('drawend', (ev) => {
            const geometry = ev.feature.getGeometry() as Polygon;
            const extent = geometry.getExtent();
            area.current = [toLonLat([extent[0], extent[1]]), toLonLat([extent[2], extent[3]])];
        });

        map.addInteraction(draw);

        // 右键取消绘图选取
        map.getViewport().addEventListener('contextmenu', function (evt) {
            evt.preventDefault(); // 阻止浏览器的默认右键菜单
            draw.abortDrawing();  // 取消当前的绘图
        });

        const syncZoom = () => {
            const zoom = map.getView().getZoom();
            if (zoom !== undefined) {
                setMapZoom(Math.round(zoom));
            }
        };
        map.getView().on("change:resolution", syncZoom);
        syncZoom();

        mapRef.current = map;
    }, [servers, choice, customUrl]);

    const clearGeometry = () => {
        vectorLayer.current?.getSource()?.clear();
        area.current = [[NaN, NaN],[NaN,NaN]];
    }

    // 按行政区边界框选，下载仍使用该边界的经纬度范围
    const applyOutline = async (adcode: string, token: number) => {
        try {
            const res = await fetch(`${DATAV_BOUND}/${adcode}.json`);
            if (!res.ok) {
                throw new Error(String(res.status));
            }
            const json = await res.json();
            if (token !== regionToken.current) {
                return;
            }
            const features = geoJsonFormat.readFeatures(json, {
                dataProjection: "EPSG:4326",
                featureProjection: "EPSG:3857",
            });
            const source = vectorSource.current;
            if (!source || features.length === 0) {
                throw new Error("empty");
            }
            source.clear();
            source.addFeatures(features);
            const extent = source.getExtent();
            area.current = [toLonLat([extent[0], extent[1]]), toLonLat([extent[2], extent[3]])];
            mapRef.current?.getView().fit(extent, { padding: [48, 380, 140, 48], duration: 250, maxZoom: 12 });
        } catch {
            if (token !== regionToken.current) {
                return;
            }
            setAlertMessage(t("gis-tile-download.message.region-failed"));
            setShowAlert(true);
        }
    }

    const resetRegion = () => {
        regionToken.current++;
        setCountryCode("");
        setProvinceCode("");
        setCityCode("");
        setDistrictCode("");
        setCities([]);
        setDistricts([]);
    }

    const onCountry = (adcode: string) => {
        const token = ++regionToken.current;
        setCountryCode(adcode);
        setProvinceCode("");
        setCityCode("");
        setDistrictCode("");
        setCities([]);
        setDistricts([]);
        if (!adcode) {
            clearGeometry();
            return;
        }
        void applyOutline(adcode, token);
    }

    const onProvince = async (adcode: string) => {
        const token = ++regionToken.current;
        setProvinceCode(adcode);
        setCityCode("");
        setDistrictCode("");
        setCities([]);
        setDistricts([]);
        if (!adcode) {
            if (countryCode) {
                void applyOutline(countryCode, token);
            } else {
                clearGeometry();
            }
            return;
        }
        setCountryCode("");
        void applyOutline(adcode, token);
        const node = provinces.find((item) => item.adcode === adcode);
        if (!node || node.childrenNum <= 0) {
            return;
        }
        const children = await fetchAreaNodes(adcode);
        if (token !== regionToken.current) {
            return;
        }
        const cityNodes = children.filter((item) => item.level === "city");
        if (cityNodes.length > 0) {
            setCities(cityNodes);
        } else {
            setDistricts(children.filter((item) => item.level === "district"));
        }
    }

    const onCity = async (adcode: string) => {
        const token = ++regionToken.current;
        setCityCode(adcode);
        setDistrictCode("");
        setDistricts([]);
        if (!adcode) {
            if (provinceCode) {
                void applyOutline(provinceCode, token);
            }
            return;
        }
        void applyOutline(adcode, token);
        const node = cities.find((item) => item.adcode === adcode);
        if (!node || node.childrenNum <= 0) {
            return;
        }
        const children = await fetchAreaNodes(adcode);
        if (token !== regionToken.current) {
            return;
        }
        setDistricts(children.filter((item) => item.level === "district"));
    }

    const onDistrict = (adcode: string) => {
        const token = ++regionToken.current;
        setDistrictCode(adcode);
        if (!adcode) {
            const parent = cityCode || provinceCode;
            if (parent) {
                void applyOutline(parent, token);
            }
            return;
        }
        void applyOutline(adcode, token);
    }

    // 清除框选
    const cleanDraw = () => {
        clearGeometry();
        resetRegion();
    }

    // 框选全部
    const selectAll = () => {
        cleanDraw();
        const extent = transformExtent([-180, -85, 180, 85], 'EPSG:4326', "EPSG:3857")
        const box = new Feature({
            geometry: fromExtent(extent)
        })

        vectorLayer.current?.getSource()?.addFeature(box);
        area.current = [toLonLat([extent[0], extent[1]]), toLonLat([extent[2], extent[3]])];
    }

    return (
        <Box ref={mapDivRef} style={mapStyle}>
            <Paper sx={{ position: "fixed", top: 72, left: 44, zIndex: 1, px: 1, py: 0.25 }}>
                <Typography variant="body2">{t("gis-tile-download.map-zoom")} {mapZoom}</Typography>
            </Paper>
            <Box sx={{
                    position:"fixed", 
                    bottom:20, 
                    right:20,
                    zIndex:1, 
                }}
            >
                <Stack spacing={1}>
                    <Paper sx={{pt:1, pb:1, pl:1, pr:1, width:320}}>
                        <Grid container spacing={1}>
                            <Grid size={12}>
                                <Select fullWidth variant="standard" value={`${choice}`} onChange={(ev:SelectChangeEvent) => {setChoice(Number(ev.target.value));}}>
                                    {
                                        servers.map((server, index) => (
                                            <MenuItem key={index} value={index}>{server.name}</MenuItem>
                                        ))
                                    }
                                    <MenuItem key={servers.length} value={servers.length}>{t("common.custom")}</MenuItem>
                                </Select>

                                {
                                    choice < servers.length && servers[choice].url.includes("tianditu.gov.cn") &&
                                    <TextField
                                        fullWidth
                                        autoComplete="off"
                                        variant="standard"
                                        placeholder={t("gis-tile-download.tianditu-key")}
                                        helperText={t("gis-tile-download.message.tianditu-key")}
                                        value={tiandituKey}
                                        onChange={(ev) => {
                                            const value = ev.target.value.trim();
                                            setTiandituKey(value);
                                            localStorage.setItem("tianditu-tk", value);
                                        }}
                                    />
                                }

                                {
                                    choice === servers.length && 
                                    <TextField 
                                        fullWidth
                                        autoComplete='off'
                                        variant="standard"
                                        placeholder="http(s)://example.link/{z}/{x}/{y}.png" 
                                        helperText={t("gis-tile-download.message.enter-to-confirm")}
                                        defaultValue={customUrl} 
                                        onKeyDown={(ev) => {
                                            if (ev.key === "Enter") {
                                                setCustomUrl((ev.target as HTMLTextAreaElement).value);
                                            }
                                        }}
                                        onPaste={(ev) => {
                                            const text = ev.clipboardData.getData("text");
                                            if (isGisUrl(text)) {
                                                ev.preventDefault();
                                                (ev.target as HTMLTextAreaElement).value = text;
                                                setCustomUrl(text);
                                            }
                                        }}
                                    />
                                }
                            </Grid>
                            <Grid size={4} sx={{display:'flex', flexDirection:'column', justifyContent: 'center'}}>
                                <Typography whiteSpace='nowrap' mr={2}>{t("gis-tile-download.region")}</Typography>
                            </Grid>
                            <Grid size={8}>
                                <Stack spacing={0.5}>
                                    <Stack direction="row" spacing={1}>
                                        <AreaSelect
                                            value={countryCode}
                                            placeholder={t("gis-tile-download.country")}
                                            options={[{ adcode: CHINA_ADCODE, name: t("gis-tile-download.country"), level: "country", childrenNum: 0 }]}
                                            allowEmpty={false}
                                            onChange={onCountry}
                                        />
                                        <AreaSelect
                                            value={provinceCode}
                                            placeholder={t("gis-tile-download.province")}
                                            options={provinces}
                                            disabled={provinces.length === 0}
                                            onChange={onProvince}
                                        />
                                    </Stack>
                                    <Stack direction="row" spacing={1}>
                                        <AreaSelect
                                            value={cityCode}
                                            placeholder={t("gis-tile-download.city")}
                                            options={cities}
                                            disabled={cities.length === 0}
                                            onChange={onCity}
                                        />
                                        <AreaSelect
                                            value={districtCode}
                                            placeholder={t("gis-tile-download.district")}
                                            options={districts}
                                            disabled={districts.length === 0}
                                            onChange={onDistrict}
                                        />
                                    </Stack>
                                </Stack>
                            </Grid>
                            <Grid size={4} sx={{display:'flex', flexDirection:'column', justifyContent: 'center'}}>
                                <Typography whiteSpace='nowrap' mr={2}>{t("gis-tile-download.z-range")}</Typography>
                            </Grid>
                            <Grid size={8} sx={{display:'flex', flexDirection:'column', justifyContent: 'center'}}>
                                <Slider valueLabelDisplay="auto" value={zoomRange} step={1} marks min={0} max={23} onChange={(_, v) => {setZoomRange(v as number[]);}}/>
                            </Grid>
                            <Grid size={4} sx={{display:'flex', flexDirection:'column', justifyContent: 'center'}}>
                                <Typography whiteSpace='nowrap' mr={2}>{t("gis-tile-download.concurrency")}</Typography>
                            </Grid>
                            <Grid size={8} sx={{display:'flex', flexDirection:'column', justifyContent: 'center'}}>
                                <Slider valueLabelDisplay="auto" value={concurrency} step={1} marks min={1} max={20} onChange={(_, v) => {setConcurrency(v as number);}}/>
                            </Grid>
                        </Grid>
                    </Paper>

                    <Box display="flex" gap={1}>
                        <Tooltip title={t("gis-tile-download.locate")} arrow>
                            <Paper sx={{width: "fit-content", display: "inline-block"}} >
                                <IconButton onClick={locate}>
                                    <MyLocationIcon/>
                                </IconButton>
                            </Paper>
                        </Tooltip>

                        
                        <Tooltip title={t("gis-tile-download.select-all")} arrow>
                            <Paper sx={{width: "fit-content", display: "inline-block"}} >
                                <IconButton onClick={selectAll}>
                                    <FullscreenIcon/>
                                </IconButton>
                            </Paper>
                        </Tooltip>
                        
                        <Tooltip title={t("gis-tile-download.clear")}  arrow>
                            <Paper sx={{width: "fit-content", display: "inline-block"}} >
                                <IconButton onClick={cleanDraw}>
                                    <CleaningServicesIcon/>
                                </IconButton>
                            </Paper>
                        </Tooltip>

                        <Box flexGrow={1}/>
                        <Button variant='contained' onClick={download}>{t("gis-tile-download.download")}</Button>
                    </Box>
                </Stack>
            </Box>

            <ProgressDialog open={showProgress} value={progressValue} max={progressMax} onCancel={() => {downloading.current=false;}}>
                <Alert severity="info" sx={{pt:0, pb:0, mr:2}}>{t('gis-tile-download.message.please-keep')}</Alert>
                <Alert severity="warning" sx={{pt:0, pb:0, mr:2}}>{t('gis-tile-download.message.copyright-alert')}</Alert>
            </ProgressDialog>
            
            <Slide in={showAlert} direction="up">
                <Snackbar open={showAlert}  autoHideDuration={2000} onClose={closeSnakebar}>
                    <Alert
                        severity="warning"
                        sx={{ width: '100%' }}
                    >
                        {alertMessage}
                    </Alert>
                </Snackbar>
            </Slide>
        </Box>
    );
}