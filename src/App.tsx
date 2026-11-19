import { Box, CssBaseline, ThemeProvider, createTheme, PaletteMode } from "@mui/material";
import { Suspense, useCallback, useState } from "react";
import TitleBar from "./components/TitleBar";
import i18n from "i18next";
import { useTranslation } from "react-i18next";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import GlobalSettings, { SettingsManager, Theme } from "./settings";
import { cyan } from "@mui/material/colors";
import React from "react";

const GisTileDownload = React.lazy(() => import("./pages/GisTileDownload"));

export default function App() {
    const [themeMode, setThemeMode] = useState(createTheme({ palette: { mode: GlobalSettings.finalTheme() as PaletteMode, info: cyan } }));

    const settingsChanged = (manager: SettingsManager) => {
        i18n.changeLanguage(manager.finalLanguage());
        setThemeMode(createTheme({ palette: { mode: manager.finalTheme() as PaletteMode, info: cyan } }));
        document.querySelector("html")?.setAttribute("lang", manager.finalLanguage() === "chinese" ? "zh" : "en");
    };

    GlobalSettings.setChangedCallback(settingsChanged);

    const { t } = useTranslation();
    const [titleHeight, setTitleHeight] = useState(0);
    const measure = useCallback((node: HTMLElement | null) => {
        if (node !== null) {
            setTitleHeight(node.getBoundingClientRect().height);
        }
    }, []);

    return (
        <ThemeProvider theme={themeMode}>
            <CssBaseline />
            <Box display="flex" flexDirection="column" height="100%">
                <TitleBar
                    ref={measure}
                    title={t("title")}
                    theme={GlobalSettings.theme()}
                    language={GlobalSettings.language()}
                    onTheme={(theme) => GlobalSettings.toggleTheme(theme as Theme)}
                    onLanguage={() => GlobalSettings.toggleLanguage()}
                />
                <Box component="main" height={`calc(100% - ${titleHeight}px)`} flexGrow={1} overflow="hidden">
                    <Suspense>
                        <GisTileDownload />
                    </Suspense>
                </Box>
            </Box>
        </ThemeProvider>
    );
}
