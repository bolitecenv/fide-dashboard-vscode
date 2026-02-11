use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use crate::config::Config;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MotorTelemetry {
    pub timestamp: u64,
    pub speed: f64,        // RPM
    pub torque: f64,       // Nm
    pub temperature: f64,  // Celsius
    pub current: f64,      // Amperes
    pub status: String,
}

pub struct MotorSimulator {
    speed: f64,
    target_speed: f64,
    torque: f64,
    temperature: f64,
    current: f64,
    max_speed: f64,
    acceleration: f64,
}

impl MotorSimulator {
    pub fn new(config: Config) -> Self {
        Self {
            speed: 0.0,
            target_speed: 1500.0, // Start with 1500 RPM target
            torque: 0.0,
            temperature: 25.0,
            current: 0.0,
            max_speed: config.max_speed,
            acceleration: config.acceleration,
        }
    }

    pub fn update(&mut self, dt: f64) {
        // Simulate acceleration/deceleration
        let speed_diff = self.target_speed - self.speed;
        let delta_speed = speed_diff.signum() * self.acceleration * dt;
        
        if speed_diff.abs() < delta_speed.abs() {
            self.speed = self.target_speed;
        } else {
            self.speed += delta_speed;
        }

        // Clamp speed
        self.speed = self.speed.clamp(0.0, self.max_speed);

        // Simulate torque (proportional to speed change)
        self.torque = (self.target_speed - self.speed).abs() * 0.05;

        // Simulate current (proportional to torque)
        self.current = self.torque * 0.1 + self.speed * 0.001;

        // Simulate temperature (increases with load)
        let heat_generation = self.current * 0.5;
        let cooling = (self.temperature - 25.0) * 0.1;
        self.temperature += (heat_generation - cooling) * dt;

        // Vary target speed periodically for realistic simulation
        let time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();
        self.target_speed = 1500.0 + 500.0 * (time * 0.2).sin();
    }

    pub fn get_telemetry(&self) -> MotorTelemetry {
        MotorTelemetry {
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            speed: self.speed,
            torque: self.torque,
            temperature: self.temperature,
            current: self.current,
            status: if self.speed > 100.0 {
                "running".to_string()
            } else {
                "idle".to_string()
            },
        }
    }

    #[allow(dead_code)]
    pub fn set_target_speed(&mut self, speed: f64) {
        self.target_speed = speed.clamp(0.0, self.max_speed);
    }
}
