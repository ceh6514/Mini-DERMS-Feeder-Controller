import { getTodayHourlyWeather } from '../services/weather/openMeteoClient';
import {
  defaultSolarModelConfig,
  estimatePvPowerW,
} from '../services/solar/solarIrradianceModel';
import { saveSolarWeatherSample } from '../repositories/telemetryRepo';

const SOLAR_FEEDER_ID = 'solar-feeder-1';

function findClosestHour(timeSeries: string[], targetMs: number): number {
  let closestIndex = 0;
  let smallestDiff = Number.POSITIVE_INFINITY;

  for (let i = 0; i < timeSeries.length; i++) {
    const parsed = new Date(timeSeries[i]).getTime();
    if (Number.isNaN(parsed)) {
      continue;
    }

    const diff = Math.abs(parsed - targetMs);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      closestIndex = i;
    }
  }

    if (!Number.isFinite(smallestDiff)) {
      throw new Error('No valid timestamps returned from weather data');
    }

  return closestIndex;
}

/**
 * Fetch current weather, estimate PV output, and store a telemetry sample for the solar feeder.
 */
export async function runOnce(): Promise<void> {
  const weather = await getTodayHourlyWeather();

  if (!weather.length) {
    throw new Error("No hourly weather data returned from Open-Meteo");
  }

  const nowMs = Date.now();
  const closestIndex = findClosestHour(
    weather.map((point) => point.time),
    nowMs,
  );
  const closestWeather = weather[closestIndex];

  const config = defaultSolarModelConfig();
  const estimatedPowerW = estimatePvPowerW(closestWeather, config);

  await saveSolarWeatherSample({
    feederId: SOLAR_FEEDER_ID,
    timestamp: closestWeather.time,
    cloudCoverPct: closestWeather.cloudCoverPct,
    shortwaveRadiationWm2: closestWeather.shortwaveRadiationWm2,
    estimatedPowerW,
  });

  console.log(
    `Saved solar weather sample @ ${closestWeather.time}: cloud=${closestWeather.cloudCoverPct}% radiation=${closestWeather.shortwaveRadiationWm2}W/m^2 power=${estimatedPowerW.toFixed(2)}W`,
  );
}

  if (require.main === module) {
    runOnce().catch((error) => {
      console.error('Failed to update solar feeder from weather', error);
      process.exit(1);
    });
  }
