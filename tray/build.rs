fn main() {
    #[cfg(windows)]
    {
        let mut res = winres::WindowsResource::new();
        res.set_icon("../assets/otter.ico");
        res.set_icon_with_id("../assets/otter.ico", "otter");
        res.set_icon_with_id("../assets/otter.ico", "tray-default");
        res.set("ProductName", "Otter Background Agent");
        res.set("FileDescription", "Otter Native System Tray Controller");
        res.set("LegalCopyright", "Copyright (C) 2026");
        let _ = res.compile();
    }
}

