use crate::motor::MotorTelemetry;

/// Format motor telemetry as DLT viewer compatible register messages
pub fn format_as_dlt_registers(telemetry: &MotorTelemetry) -> Vec<String> {
    vec![
        format!("REG:SPEED:{:.2}", telemetry.speed),
        format!("REG:TORQUE:{:.2}", telemetry.torque),
        format!("REG:TEMP:{:.2}", telemetry.temperature),
        format!("REG:CURRENT:{:.2}", telemetry.current),
        format!("REG:STATUS:{}", telemetry.status),
    ]
}

/// Format as timestamped register updates for DLT trace view
pub fn format_as_dlt_trace(telemetry: &MotorTelemetry) -> Vec<String> {
    vec![
        format!("MOTOR:{}:update:SPEED={:.0}", telemetry.timestamp, telemetry.speed),
        format!("MOTOR:{}:update:TORQUE={:.1}", telemetry.timestamp, telemetry.torque),
        format!("MOTOR:{}:update:TEMP={:.1}", telemetry.timestamp, telemetry.temperature),
        format!("MOTOR:{}:update:CURRENT={:.2}", telemetry.timestamp, telemetry.current),
    ]
}

/// Format as single-line register dump
pub fn format_as_register_dump(telemetry: &MotorTelemetry) -> String {
    format!(
        "SPEED:{:.0} TORQUE:{:.1} TEMP:{:.1} CURRENT:{:.2} STATUS:{}",
        telemetry.speed,
        telemetry.torque,
        telemetry.temperature,
        telemetry.current,
        telemetry.status
    )
}

/// Format as chart data: Name:Timestamp:Value
pub fn format_as_chart_data(telemetry: &MotorTelemetry) -> Vec<String> {
    vec![
        format!("SPEED:{}:{:.2}", telemetry.timestamp, telemetry.speed),
        format!("TORQUE:{}:{:.2}", telemetry.timestamp, telemetry.torque),
        format!("TEMP:{}:{:.2}", telemetry.timestamp, telemetry.temperature),
        format!("CURRENT:{}:{:.2}", telemetry.timestamp, telemetry.current),
    ]
}
