pub struct Config {
    pub max_speed: f64,        // Maximum RPM
    pub acceleration: f64,     // RPM per second
    pub websocket_port: u16,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            max_speed: 3000.0,
            acceleration: 500.0,
            websocket_port: 8084,
        }
    }
}
