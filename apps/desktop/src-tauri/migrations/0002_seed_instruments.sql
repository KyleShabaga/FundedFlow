-- FundedFlow: built-in futures instruments commonly traded on simulated
-- prop-firm accounts (migration 0002). Users can add or override instruments;
-- built-ins are identified by is_built_in = 1 and fixed 'builtin:' IDs.
--
-- point_value = USD per 1.0 price move per contract.

INSERT INTO instruments
    (id, symbol_root, display_name, asset_class, exchange, currency, point_value, tick_size, is_built_in, created_at, updated_at)
VALUES
    ('builtin:instrument:ES',  'ES',  'E-mini S&P 500',          'future', 'CME',   'USD', '50',     '0.25',     1, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
    ('builtin:instrument:MES', 'MES', 'Micro E-mini S&P 500',    'future', 'CME',   'USD', '5',      '0.25',     1, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
    ('builtin:instrument:NQ',  'NQ',  'E-mini Nasdaq-100',       'future', 'CME',   'USD', '20',     '0.25',     1, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
    ('builtin:instrument:MNQ', 'MNQ', 'Micro E-mini Nasdaq-100', 'future', 'CME',   'USD', '2',      '0.25',     1, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
    ('builtin:instrument:YM',  'YM',  'E-mini Dow',              'future', 'CBOT',  'USD', '5',      '1',        1, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
    ('builtin:instrument:MYM', 'MYM', 'Micro E-mini Dow',        'future', 'CBOT',  'USD', '0.5',    '1',        1, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
    ('builtin:instrument:RTY', 'RTY', 'E-mini Russell 2000',     'future', 'CME',   'USD', '50',     '0.1',      1, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
    ('builtin:instrument:M2K', 'M2K', 'Micro E-mini Russell 2000','future','CME',   'USD', '5',      '0.1',      1, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
    ('builtin:instrument:CL',  'CL',  'Crude Oil',               'future', 'NYMEX', 'USD', '1000',   '0.01',     1, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
    ('builtin:instrument:MCL', 'MCL', 'Micro Crude Oil',         'future', 'NYMEX', 'USD', '100',    '0.01',     1, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
    ('builtin:instrument:GC',  'GC',  'Gold',                    'future', 'COMEX', 'USD', '100',    '0.1',      1, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
    ('builtin:instrument:MGC', 'MGC', 'Micro Gold',              'future', 'COMEX', 'USD', '10',     '0.1',      1, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
    ('builtin:instrument:SI',  'SI',  'Silver',                  'future', 'COMEX', 'USD', '5000',   '0.005',    1, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
    ('builtin:instrument:6E',  '6E',  'Euro FX',                 'future', 'CME',   'USD', '125000', '0.00005',  1, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
    ('builtin:instrument:M6E', 'M6E', 'Micro Euro FX',           'future', 'CME',   'USD', '12500',  '0.0001',   1, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
    ('builtin:instrument:ZN',  'ZN',  '10-Year T-Note',          'future', 'CBOT',  'USD', '1000',   '0.015625', 1, '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z');
