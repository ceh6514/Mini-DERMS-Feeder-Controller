export const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Mini DERMS Feeder Controller API',
    version: '1.0.0',
    description:
      'REST API for retrieving feeder telemetry, managing devices, and posting curtailment events.',
  },
  servers: [{ url: 'http://localhost:3001' }],
  paths: {
    '/api/health': {
      get: {
        summary: 'Health check',
        responses: {
          200: {
            description: 'API is reachable',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    db: {
                      type: 'object',
                      properties: { ok: { type: 'boolean' } },
                    },
                    mqtt: {
                      type: 'object',
                      properties: {
                        host: { type: 'string' },
                        port: { type: 'number' },
                        connected: { type: 'boolean' },
                        lastError: { type: 'string', nullable: true },
                      },
                    },
                    controlLoop: {
                      type: 'object',
                      properties: {
                        status: { type: 'string', example: 'ok' },
                        lastIterationIso: {
                          type: 'string',
                          nullable: true,
                          format: 'date-time',
                        },
                        lastDurationMs: { type: 'number', nullable: true },
                        lastError: { type: 'string', nullable: true },
                        offlineCount: { type: 'number' },
                        offlineDevices: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              deviceId: { type: 'string' },
                              lastHeartbeat: { type: 'string', format: 'date-time', nullable: true },
                            },
                          },
                        },
                        heartbeatTimeoutSeconds: { type: 'number' },
                        stallThresholdSeconds: { type: 'number' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/feeder/summary': {
      get: {
        summary: 'Latest feeder totals',
        responses: {
          200: {
            description: 'Aggregated real power across all devices',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    totalKw: { type: 'number' },
                    limitKw: { type: 'number' },
                    deviceCount: { type: 'integer' },
                    byType: {
                      type: 'object',
                      additionalProperties: {
                        type: 'object',
                        properties: {
                          count: { type: 'integer' },
                          totalKw: { type: 'number' },
                        },
                      },
                    },
                  },
                  required: ['totalKw', 'limitKw', 'deviceCount', 'byType'],
                },
              },
            },
          },
        },
      },
    },
    '/api/feeder/history': {
      get: {
        summary: 'Downsampled feeder history',
        parameters: [
          {
            name: 'minutes',
            in: 'query',
            description: 'How many minutes back to include',
            schema: { type: 'integer', default: 30 },
          },
          {
            name: 'bucketSeconds',
            in: 'query',
            description: 'Aggregation bucket size in seconds',
            schema: { type: 'integer', default: 60 },
          },
        ],
        responses: {
          200: {
            description: 'Downsampled feeder power points',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    limitKw: { type: 'number' },
                    points: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          ts: { type: 'string', format: 'date-time' },
                          totalKw: { type: 'number' },
                        },
                        required: ['ts', 'totalKw'],
                      },
                    },
                  },
                  required: ['limitKw', 'points'],
                },
              },
            },
          },
        },
      },
    },
    '/api/devices': {
      get: {
        summary: 'List registered devices',
        responses: {
          200: {
            description: 'Devices with latest telemetry attached when present',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    $ref: '#/components/schemas/DeviceWithTelemetry',
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/telemetry/{deviceId}': {
      get: {
        summary: 'Recent telemetry for a device',
        parameters: [
          {
            name: 'deviceId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Telemetry rows ordered newest-first',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    $ref: '#/components/schemas/TelemetryRow',
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/telemetry': {
      post: {
        summary: 'Submit a telemetry point for a device',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  deviceId: { type: 'string' },
                  device_id: { type: 'string', description: 'Legacy alias for deviceId' },
                  ts: {
                    type: 'string',
                    format: 'date-time',
                    description: 'Alias for timestamp',
                  },
                  timestamp: { type: 'string', format: 'date-time' },
                  type: {
                    type: 'string',
                    enum: ['pv', 'battery', 'ev', 'solar_weather', 'unknown'],
                  },
                  p_actual_kw: { type: 'number' },
                  p_setpoint_kw: { type: 'number', nullable: true },
                  soc: { type: 'number', nullable: true },
                  site_id: { type: 'string' },
                  p_max_kw: { type: 'number', nullable: true },
                  priority: { type: 'number', nullable: true },
                },
                required: ['deviceId', 'timestamp', 'type', 'p_actual_kw', 'site_id'],
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Telemetry stored',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { status: { type: 'string', example: 'ok' } },
                },
              },
            },
          },
          400: { description: 'Validation error' },
        },
      },
    },
    '/api/live-devices': {
      get: {
        summary: 'Devices that reported telemetry within the last N minutes',
        parameters: [
          {
            name: 'minutes',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 2, minimum: 1 },
          },
        ],
        responses: {
          200: {
            description: 'Most recent telemetry per recently seen device',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/LiveDevice' },
                },
              },
            },
          },
        },
      },
    },
    '/api/events': {
      post: {
        summary: 'Create a feeder event (e.g., curtailment)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateEventRequest' },
            },
          },
        },
        responses: {
          201: {
            description: 'Created event',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EventRow' },
              },
            },
          },
          400: { description: 'Missing or invalid fields' },
          500: { description: 'Unexpected error' },
        },
      },
    },
    '/api/simulation/mode': {
      get: {
        summary: 'Get the active simulation profile',
        responses: {
          200: {
            description: 'Active day/night profile',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SimulationModeResponse' },
              },
            },
          },
        },
      },
      post: {
        summary: 'Set the simulation profile to day or night',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  mode: { type: 'string', enum: ['day', 'night'] },
                },
                required: ['mode'],
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Updated profile state',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SimulationModeResponse' },
              },
            },
          },
        },
      },
    },
    '/api/simulation/mode/auto': {
      post: {
        summary: 'Clear manual overrides and return to automatic day/night switching',
        responses: {
          200: {
            description: 'Profile reset to follow time-of-day',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SimulationModeResponse' },
              },
            },
          },
        },
      },
    },
    '/api/dr-programs': {
      get: {
        summary: 'List configured DR programs',
        responses: {
          200: {
            description: 'All DR programs ordered by start time',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/DrProgram' },
                },
              },
            },
          },
        },
      },
      post: {
        summary: 'Create a new DR program',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/DrProgramCreateRequest' },
            },
          },
        },
        responses: {
          201: {
            description: 'Program created',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/DrProgram' } },
            },
          },
        },
      },
    },
    '/api/dr-programs/active': {
      get: {
        summary: 'Get the active DR program and its latest impact',
        responses: {
          200: {
            description: 'Active program (if any) and the control-loop impact snapshot',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    program: { anyOf: [{ $ref: '#/components/schemas/DrProgram' }, { type: 'null' }] },
                    impact: {
                      anyOf: [
                        { $ref: '#/components/schemas/DrImpact' },
                        { type: 'null' },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/dr-programs/{id}': {
      get: {
        summary: 'Fetch a DR program by id',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          200: {
            description: 'Program details',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/DrProgram' } },
            },
          },
          404: { description: 'Not found' },
        },
      },
      put: {
        summary: 'Update a DR program',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/DrProgramUpdateRequest' },
            },
          },
        },
        responses: {
          200: {
            description: 'Updated program',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/DrProgram' } },
            },
          },
        },
      },
      delete: {
        summary: 'Delete a DR program',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          204: { description: 'Deleted' },
        },
      },
    },
    '/api/dr-programs/{id}/activate': {
      post: {
        summary: 'Activate a DR program and deactivate any existing one',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          200: {
            description: 'Activated program',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/DrProgram' } },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      TelemetryRow: {
        type: 'object',
        properties: {
          id: { type: 'integer', nullable: true },
          device_id: { type: 'string' },
          ts: { type: 'string', format: 'date-time' },
          type: { type: 'string' },
          p_actual_kw: { type: 'number' },
          p_setpoint_kw: { type: 'number', nullable: true },
          soc: { type: 'number', nullable: true },
          site_id: { type: 'string' },
          device_p_max_kw: { type: 'number', nullable: true },
        },
        required: ['device_id', 'ts', 'type', 'p_actual_kw', 'site_id'],
      },
      DeviceWithTelemetry: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string' },
          siteId: { type: 'string' },
          pMaxKw: { type: 'number' },
          priority: { type: 'number', nullable: true },
          latestTelemetry: {
            anyOf: [{ $ref: '#/components/schemas/TelemetryRow' }, { type: 'null' }],
          },
          isPi: { type: 'boolean' },
          isSimulated: { type: 'boolean' },
        },
        required: [
          'id',
          'type',
          'siteId',
          'pMaxKw',
          'priority',
          'latestTelemetry',
          'isPi',
          'isSimulated',
        ],
      },
      LiveDevice: {
        type: 'object',
        properties: {
          deviceId: { type: 'string' },
          type: { type: 'string' },
          siteId: { type: 'string' },
          pMaxKw: { type: 'number' },
          priority: { type: 'number', nullable: true },
          lastSeen: { type: 'string', format: 'date-time' },
          pActualKw: { type: 'number' },
          pSetpointKw: { type: 'number', nullable: true },
          soc: { type: 'number', nullable: true },
        },
        required: [
          'deviceId',
          'type',
          'siteId',
          'pMaxKw',
          'priority',
          'lastSeen',
          'pActualKw',
          'pSetpointKw',
          'soc',
        ],
      },
      EventRow: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          ts_start: { type: 'string', format: 'date-time' },
          ts_end: { type: 'string', format: 'date-time' },
          limit_kw: { type: 'number' },
          type: { type: 'string' },
        },
        required: ['id', 'ts_start', 'ts_end', 'limit_kw', 'type'],
      },
      CreateEventRequest: {
        type: 'object',
        properties: {
          tsStart: { type: 'string', format: 'date-time' },
          tsEnd: { type: 'string', format: 'date-time' },
          limitKw: { type: 'number' },
          type: { type: 'string' },
        },
        required: ['tsStart', 'tsEnd', 'limitKw', 'type'],
      },
      SimulationModeResponse: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['day', 'night'] },
          source: { type: 'string', enum: ['auto', 'manual'] },
          lastUpdated: { type: 'string', nullable: true, format: 'date-time' },
        },
        required: ['mode', 'source', 'lastUpdated'],
      },
      DrProgram: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          mode: { type: 'string', enum: ['fixed_cap', 'price_elastic'] },
          ts_start: { type: 'string', format: 'date-time' },
          ts_end: { type: 'string', format: 'date-time' },
          target_shed_kw: { type: 'number', nullable: true },
          incentive_per_kwh: { type: 'number', nullable: true },
          penalty_per_kwh: { type: 'number', nullable: true },
          is_active: { type: 'boolean' },
        },
        required: [
          'id',
          'name',
          'mode',
          'ts_start',
          'ts_end',
          'target_shed_kw',
          'incentive_per_kwh',
          'penalty_per_kwh',
          'is_active',
        ],
      },
      DrProgramCreateRequest: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          mode: { type: 'string', enum: ['fixed_cap', 'price_elastic'] },
          tsStart: { type: 'string', format: 'date-time' },
          tsEnd: { type: 'string', format: 'date-time' },
          targetShedKw: { type: 'number', nullable: true },
          incentivePerKwh: { type: 'number', nullable: true },
          penaltyPerKwh: { type: 'number', nullable: true },
          isActive: { type: 'boolean' },
        },
        required: ['name', 'mode', 'tsStart', 'tsEnd'],
      },
      DrProgramUpdateRequest: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          mode: { type: 'string', enum: ['fixed_cap', 'price_elastic'] },
          tsStart: { type: 'string', format: 'date-time' },
          tsEnd: { type: 'string', format: 'date-time' },
          targetShedKw: { type: 'number', nullable: true },
          incentivePerKwh: { type: 'number', nullable: true },
          penaltyPerKwh: { type: 'number', nullable: true },
          isActive: { type: 'boolean' },
        },
      },
      DrImpact: {
        type: 'object',
        properties: {
          timestampIso: { type: 'string', format: 'date-time' },
          availableBeforeKw: { type: 'number' },
          availableAfterKw: { type: 'number' },
          shedAppliedKw: { type: 'number' },
          elasticityFactor: { type: 'number' },
          totalEvKw: { type: 'number' },
          nonEvKw: { type: 'number' },
          avgUtilizationPct: { type: 'number' },
          priorityWeightedUtilizationPct: { type: 'number' },
          activeProgram: { anyOf: [{ $ref: '#/components/schemas/DrProgram' }, { type: 'null' }] },
          perDevice: {
            type: 'array',
            items: { $ref: '#/components/schemas/DrImpactDevice' },
          },
        },
      },
      DrImpactDevice: {
        type: 'object',
        properties: {
          deviceId: { type: 'string' },
          allowedKw: { type: 'number' },
          pMax: { type: 'number' },
          utilizationPct: { type: 'number' },
          priority: { type: 'number' },
        },
      },
    },
  },
} as const;
