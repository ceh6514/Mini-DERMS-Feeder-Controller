import { HourlyWeatherPoint } from "../weather/openMeteoClient";

export interface SolarModelConfig {
  panelAreaM2: number;
  panelEfficiency: number;
  numPanels: number;
}

/**
 * Estimate photovoltaic power output in Watts for a single hourly weather datapoint.
 * The calculation scales shortwave radiation by panel area, efficiency, and panel count.
 */
export function estimatePvPowerW(
  weather: HourlyWeatherPoint,
  config: SolarModelConfig
): number {
  const shortwaveRadiation = Math.max(0, weather.shortwaveRadiationWm2 ?? 0);

  const rawPower =
    shortwaveRadiation * config.panelAreaM2 * config.panelEfficiency * config.numPanels;

  return Math.max(0, rawPower);
}

export function defaultSolarModelConfig(): SolarModelConfig {
  return {
    panelAreaM2: 1.7,
    panelEfficiency: 0.18,
    numPanels: 1,
  };
}
