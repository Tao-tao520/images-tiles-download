import { AppBar, Box, IconButton, Toolbar, Tooltip, Typography } from "@mui/material";
import LightModeIcon from "@mui/icons-material/LightMode";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import BrightnessAutoIcon from "@mui/icons-material/BrightnessAuto";
import TranslateIcon from "@mui/icons-material/Translate";
import React, { Ref } from "react";
import { useTranslation } from "react-i18next";
import { Language, Theme } from "../settings";

export interface TitleBarProps {
    title: string;
    theme: Theme;
    language: Language;
    onTheme: (theme: Theme) => void;
    onLanguage: () => void;
}

export function TitleBar(props: TitleBarProps, ref?: Ref<HTMLDivElement>) {
    const { t } = useTranslation();

    return (
        <Box ref={ref}>
            <AppBar component="nav" color="primary" elevation={0}>
                <Toolbar>
                    <Typography variant="h6" component="div" sx={{ whiteSpace: "nowrap" }}>
                        {props.title}
                    </Typography>
                    <Box sx={{ flexGrow: 1 }} />
                    <Tooltip title={t("settings.themes.light")}>
                        <IconButton color="inherit" onClick={() => props.onTheme("light")} sx={{ opacity: props.theme === "light" ? 1 : 0.55 }}>
                            <LightModeIcon />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={t("settings.themes.auto")}>
                        <IconButton color="inherit" onClick={() => props.onTheme("auto")} sx={{ opacity: props.theme === "auto" ? 1 : 0.55 }}>
                            <BrightnessAutoIcon />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={t("settings.themes.dark")}>
                        <IconButton color="inherit" onClick={() => props.onTheme("dark")} sx={{ opacity: props.theme === "dark" ? 1 : 0.55 }}>
                            <DarkModeIcon />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={t(`settings.languages.${props.language}`)}>
                        <IconButton color="inherit" onClick={props.onLanguage} sx={{ ml: 1 }}>
                            <TranslateIcon />
                        </IconButton>
                    </Tooltip>
                </Toolbar>
            </AppBar>
            <Toolbar />
        </Box>
    );
}

export default React.forwardRef(TitleBar);
