export type Direction = 'Long' | 'Short';
export type SetupType = 'Reversal' | 'Continuation' | 'Breakout' | 'Other';
export type SessionType = 'London' | 'New York' | 'Asia' | 'Overlap' | 'Other';
export type TradeOutcome = 'Win' | 'Loss' | 'BE' | 'Missed';
export type MetricUnit = 'r' | 'percent' | 'money' | 'value';
export type ModelType = 'Reversal' | 'Continuation' | 'Both';
export type CustomFieldType = 'text' | 'number' | 'both';

export type PageId =
  | 'dashboard'
  | 'journal'
  | 'calendar'
  | 'models'
  | 'analytics'
  | 'playbook'
  | 'ai'
  | 'settings';

export type CustomFieldValue =
  | string
  | {
      text?: string;
      number?: string;
    };

export interface TradeScreenshot {
  id: string;
  name: string;
  dataUrl: string;
  createdAt: string;
}

export interface Trade {
  id: string;
  date: string; // ISO local datetime string YYYY-MM-DDTHH:mm
  pair: string;
  direction: Direction;
  setup: SetupType;
  session: SessionType;
  result: TradeOutcome;
  r: number;
  risk: number;
  pnlUnit?: MetricUnit;
  riskUnit?: MetricUnit;
  currency?: string;
  model: string;
  tags?: string[];
  notes: string;
  custom: Record<string, CustomFieldValue>;
  images: TradeScreenshot[];
  imageData?: string; // Legacy compatibility for V9/V10 single-image backups
  createdAt: string;
  updatedAt?: string;
}

export interface TradingModel {
  id: string;
  name: string;
  type: ModelType;
  entry: string;
  risk: string;
}

export interface CustomField {
  id: string;
  name: string;
  type: CustomFieldType;
  required: boolean;
  hint: string;
  options: string[];
}

export interface Playbook {
  core: string;
  rev: string;
  cont: string;
  entry: string;
  risk: string;
}

export interface SessionAlarm {
  id: string;
  name: string;
  time: string; // HH:mm
  enabled: boolean;
}

export interface UserProfile {
  name: string;
  market: string;
}

export interface JournalSettings {
  quoteFrequency: number; // 30 | 60 | 120 | 240 | 0 (0 = only at session alarms)
  quoteNotifications: boolean;
  defaultPnlUnit?: MetricUnit;
  defaultRiskUnit?: MetricUnit;
  currency?: string;
}

export type DashboardWidgetId = 'monthlyGrowth' | 'topSetups' | 'sessionWinRate';

export type DashboardWidgetsConfig = Record<DashboardWidgetId, boolean>;

export interface JournalState {
  trades: Trade[];
  models: TradingModel[];
  fields: CustomField[];
  playbook: Playbook;
  playbookChecks?: Record<string, boolean>;
  alarms: SessionAlarm[];
  profile: UserProfile;
  settings: JournalSettings;
}

export interface BackupPayload extends JournalState {
  format: 'msl-v10' | 'msl-v10-premium';
  version: number;
  exportedAt: string;
}

export interface UnitStatsBreakdown {
  unit: MetricUnit;
  currency: string;
  count: number;
  net: number;
  grossWin: number;
  grossLoss: number;
}

export interface JournalStats {
  totalTrades: number; // Executed trades count (Win + Loss + BE; excludes Missed)
  allLoggedCount: number; // Total entries including Missed
  wins: Trade[];
  losses: Trade[];
  breakevens: Trade[];
  missed: Trade[];
  missedOpportunityR: number;
  primaryUnit: MetricUnit;
  primaryCurrency: string;
  isMixedUnits: boolean;
  unitBreakdown: UnitStatsBreakdown[];
  netR: number;
  winRate: number;
  expectancy: number;
  profitFactor: number;
  avgWinner: number;
  avgLoser: number;
  grossWin: number;
  grossLoss: number;
  bestSession: { name: string; netR: number } | null;
  maxDrawdownR: number;
  bestTradeR: number;
  worstTradeR: number;
  currentStreak: { type: 'Win' | 'Loss' | 'None'; count: number };
  bestWinStreak: number;
}

export interface AIChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
}

export interface AISourceCitation {
  title: string;
  uri: string;
}

export type AIAppAction =
  | {
      name: 'navigate_app';
      args: { page: PageId };
    }
  | {
      name: 'open_log_trade_modal';
      args: { initialDate?: string };
    }
  | {
      name: 'log_trade';
      args: {
        pair: string;
        direction: Direction;
        setup: SetupType;
        session: SessionType;
        result: TradeOutcome;
        r: number;
        risk?: number;
        pnlUnit?: MetricUnit;
        riskUnit?: MetricUnit;
        currency?: string;
        model?: string;
        tags?: string[];
        notes?: string;
        date?: string;
      };
    }
  | {
      name: 'update_trade';
      args: {
        tradeId: string;
        pair?: string;
        direction?: Direction;
        setup?: SetupType;
        session?: SessionType;
        result?: TradeOutcome;
        r?: number;
        risk?: number;
        pnlUnit?: MetricUnit;
        riskUnit?: MetricUnit;
        currency?: string;
        model?: string;
        tags?: string[];
        notes?: string;
      };
    }
  | {
      name: 'delete_trade';
      args: { tradeId: string };
    }
  | {
      name: 'create_trading_model';
      args: { name: string; type: ModelType; entry: string; risk: string };
    }
  | {
      name: 'update_playbook';
      args: {
        core?: string;
        rev?: string;
        cont?: string;
        entry?: string;
        risk?: string;
      };
    }
  | {
      name: 'update_playbook_checks';
      args: {
        action: 'check' | 'uncheck' | 'reset';
        query?: string;
      };
    }
  | {
      name: 'set_journal_units';
      args: {
        defaultPnlUnit?: MetricUnit;
        defaultRiskUnit?: MetricUnit;
        currency?: string;
      };
    }
  | {
      name: 'update_session_alarm';
      args: { name: string; time?: string; enabled?: boolean };
    }
  | {
      name: 'cycle_motivational_quote';
      args: Record<string, never>;
    }
  | {
      name: 'save_memory';
      args: { content: string; category?: AIMemoryCategory };
    }
  | {
      name: 'forget_memory';
      args: { memoryId?: string; query?: string };
    };

export type AIMemoryCategory = 'preference' | 'rule' | 'goal' | 'context';

export interface AIMemoryItem {
  id: string;
  content: string;
  category: AIMemoryCategory;
  createdAt: string;
  updatedAt: string;
}

export interface AIAppActionResult {
  name: string;
  label: string;
  ok: boolean;
}

export interface AIChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  attachments?: AIChatAttachment[];
  actions?: AIAppActionResult[];
  sources?: AISourceCitation[];
  createdAt: string;
  error?: boolean;
  interrupted?: boolean;
  viaVoice?: boolean;
}

export interface AIConversation {
  id: string;
  title: string;
  messages: AIChatMessage[];
  updatedAt: string;
}
