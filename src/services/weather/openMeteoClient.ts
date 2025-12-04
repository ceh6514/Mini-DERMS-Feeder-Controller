const OPEN_METEO_ENDPOINT = 'https://api.open-meteo.com/v1/forecast?latitude=32.75&longitude=-97.33&hourly=cloudcover,shortwave_radiation&forecast_days=1&timezone=America%2FChicago';

interface OpenMeteoHourlyResponse {
  time: string[];
  cloudcover: number[];
  shortwave_radiation: number[];
}

interface OpenMeteoResponse {
  hourly?: OpenMeteoHourlyResponse;
}

export interface HourlyWeatherPoint {
  time: string; // ISO string
  cloudCoverPct: number; // 0-100
  shortwaveRadiationWm2: number; // W/m^2
}

function isValidHourlyResponse(hourly: Partial<OpenMeteoHourlyResponse> | undefined): hourly is OpenMeteoHourlyResponse {
  return (
    Array.isArray(hourly?.time) &&
    Array.isArray(hourly?.cloudcover) &&
    Array.isArray(hourly?.shortwave_radiation)
  );
}

function ensureEqualLengths(hourly: OpenMeteoHourlyResponse): void {
  const { time, cloudcover, shortwave_radiation } = hourly;
  const lengths = [time.length, cloudcover.length, shortwave_radiation.length];
  const uniqueLengths = new Set(lengths);

  if (uniqueLengths.size !== 1) {
    throw new Error(
      `Hourly data arrays have mismatched lengths: time=${time.length}, cloudcover=${cloudcover.length}, shortwave_radiation=${shortwave_radiation.length}`
    );
  }
}

/**
 * Fetches today's hourly cloud cover and shortwave radiation forecast for Fort Worth, TX.
 * @returns Promise resolving to an array of hourly weather points.
 * @throws Error when the HTTP request fails or the response shape is invalid.
 */
export async function getTodayHourlyWeather(): Promise<HourlyWeatherPoint[]> {
  try {
    const response = await fetch(OPEN_METEO_ENDPOINT);

    if (!response.ok) {
      console.error(`Open-Meteo request failed with status ${response.status}: ${response.statusText}`);
      throw new Error(`Failed to fetch weather data: HTTP ${response.status}`);
    }

    const data = (await response.json()) as OpenMeteoResponse;

    if (!isValidHourlyResponse(data.hourly)) {
      console.error('Open-Meteo response missing expected hourly data', data);
      throw new Error('Unexpected Open-Meteo response shape: missing hourly data');
    }

    ensureEqualLengths(data.hourly);

    const { time, cloudcover, shortwave_radiation } = data.hourly;

    return time.map((timestamp, index) => {
      const cloudCoverPct = Number(cloudcover[index]);
      const shortwaveRadiationWm2 = Number(shortwave_radiation[index]);

      if (!Number.isFinite(cloudCoverPct) || !Number.isFinite(shortwaveRadiationWm2)) {
        throw new Error(`Invalid numeric weather values at index ${index}`);
      }

      return {
        time: timestamp,
        cloudCoverPct,
        shortwaveRadiationWm2,
      };
    });
  } catch (error) {
    console.error('Failed to parse Open-Meteo response', error);
    throw error instanceof Error
      ? error
      : new Error('Unknown error while fetching Open-Meteo weather data');
  }
}
