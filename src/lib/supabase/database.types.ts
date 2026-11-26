export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      billing_customers: {
        Row: {
          created_at: string
          stripe_customer_id: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          stripe_customer_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          stripe_customer_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'billing_customers_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      credit_ledger: {
        Row: {
          amount: number
          bucket: string
          created_at: string
          id: number
          idempotency_key: string
          kind: string
          metadata: NonNullable<Json>
          render_id: string | null
          user_id: string
        }
        ComputedFields: never
        Insert: {
          amount: number
          bucket: string
          created_at?: string
          id?: never
          idempotency_key: string
          kind: string
          metadata?: NonNullable<Json>
          render_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          bucket?: string
          created_at?: string
          id?: never
          idempotency_key?: string
          kind?: string
          metadata?: NonNullable<Json>
          render_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'credit_ledger_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      exports: {
        Row: {
          bytes: number
          created_at: string
          duration_ms: number | null
          height: number
          id: string
          kind: string
          path: string
          render_id: string
          user_id: string
          variant: string
          width: number
        }
        ComputedFields: never
        Insert: {
          bytes: number
          created_at?: string
          duration_ms?: number | null
          height: number
          id?: string
          kind: string
          path: string
          render_id: string
          user_id: string
          variant: string
          width: number
        }
        Update: {
          bytes?: number
          created_at?: string
          duration_ms?: number | null
          height?: number
          id?: string
          kind?: string
          path?: string
          render_id?: string
          user_id?: string
          variant?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: 'exports_render_id_fkey'
            columns: ['render_id']
            isOneToOne: false
            referencedRelation: 'renders'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'exports_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      paint_colors: {
        Row: {
          brand: string
          code: string
          created_at: string
          family: string
          hex: string
          id: number
          is_active: boolean
          name: string
          sort_order: number
        }
        ComputedFields: never
        Insert: {
          brand: string
          code: string
          created_at?: string
          family: string
          hex: string
          id?: never
          is_active?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          brand?: string
          code?: string
          created_at?: string
          family?: string
          hex?: string
          id?: never
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          id: string
          item_id: string
          kind: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          amount_cents: number
          created_at?: string
          currency: string
          id: string
          item_id: string
          kind: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          id?: string
          item_id?: string
          kind?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'payments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          hits: number
          key: string
          window_start: string
        }
        ComputedFields: never
        Insert: {
          hits?: number
          key: string
          window_start: string
        }
        Update: {
          hits?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      renders: {
        Row: {
          attempts: number
          client_request_id: string | null
          completed_at: string | null
          cost_usd: number | null
          created_at: string
          credits_charged: number
          deadline_at: string | null
          error_code: string | null
          error_message: string | null
          id: string
          is_saved: boolean
          job_input: Json | null
          last_checked_at: string | null
          mode: string
          model: string
          params: NonNullable<Json>
          prompt: string
          provider: string
          provider_endpoint: string | null
          provider_request_id: string | null
          result_height: number | null
          result_path: string | null
          result_width: number | null
          room_id: string
          source_render_id: string | null
          started_at: string | null
          status: string
          tier: string
          updated_at: string
          user_id: string
          watermarked_path: string | null
        }
        ComputedFields: never
        Insert: {
          attempts?: number
          client_request_id?: string | null
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          credits_charged?: number
          deadline_at?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          is_saved?: boolean
          job_input?: Json | null
          last_checked_at?: string | null
          mode: string
          model: string
          params?: NonNullable<Json>
          prompt: string
          provider: string
          provider_endpoint?: string | null
          provider_request_id?: string | null
          result_height?: number | null
          result_path?: string | null
          result_width?: number | null
          room_id: string
          source_render_id?: string | null
          started_at?: string | null
          status?: string
          tier: string
          updated_at?: string
          user_id: string
          watermarked_path?: string | null
        }
        Update: {
          attempts?: number
          client_request_id?: string | null
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          credits_charged?: number
          deadline_at?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          is_saved?: boolean
          job_input?: Json | null
          last_checked_at?: string | null
          mode?: string
          model?: string
          params?: NonNullable<Json>
          prompt?: string
          provider?: string
          provider_endpoint?: string | null
          provider_request_id?: string | null
          result_height?: number | null
          result_path?: string | null
          result_width?: number | null
          room_id?: string
          source_render_id?: string | null
          started_at?: string | null
          status?: string
          tier?: string
          updated_at?: string
          user_id?: string
          watermarked_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'renders_room_id_fkey'
            columns: ['room_id']
            isOneToOne: false
            referencedRelation: 'rooms'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'renders_source_render_id_fkey'
            columns: ['source_render_id']
            isOneToOne: false
            referencedRelation: 'renders'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'renders_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      rooms: {
        Row: {
          bytes: number
          created_at: string
          deleted_at: string | null
          height: number
          id: string
          mime_type: string
          moderation: string
          original_path: string
          room_type: string | null
          title: string | null
          user_id: string
          width: number
        }
        ComputedFields: never
        Insert: {
          bytes: number
          created_at?: string
          deleted_at?: string | null
          height: number
          id?: string
          mime_type: string
          moderation?: string
          original_path: string
          room_type?: string | null
          title?: string | null
          user_id: string
          width: number
        }
        Update: {
          bytes?: number
          created_at?: string
          deleted_at?: string | null
          height?: number
          id?: string
          mime_type?: string
          moderation?: string
          original_path?: string
          room_type?: string | null
          title?: string | null
          user_id?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: 'rooms_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      stripe_events: {
        Row: {
          error: string | null
          id: string
          processed_at: string | null
          received_at: string
          status: string
          type: string
        }
        ComputedFields: never
        Insert: {
          error?: string | null
          id: string
          processed_at?: string | null
          received_at?: string
          status?: string
          type: string
        }
        Update: {
          error?: string | null
          id?: string
          processed_at?: string | null
          received_at?: string
          status?: string
          type?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          ended_at: string | null
          id: string
          plan_id: string
          status: string
          updated_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          ended_at?: string | null
          id: string
          plan_id: string
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          ended_at?: string | null
          id?: string
          plan_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'subscriptions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      swatches: {
        Row: {
          bytes: number
          created_at: string
          deleted_at: string | null
          height: number
          id: string
          mime_type: string
          moderation: string
          path: string
          user_id: string
          width: number
        }
        ComputedFields: never
        Insert: {
          bytes: number
          created_at?: string
          deleted_at?: string | null
          height: number
          id?: string
          mime_type: string
          moderation?: string
          path: string
          user_id: string
          width: number
        }
        Update: {
          bytes?: number
          created_at?: string
          deleted_at?: string | null
          height?: number
          id?: string
          mime_type?: string
          moderation?: string
          path?: string
          user_id?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: 'swatches_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_model_costs: {
        Args: { p_since: string }
        Returns: {
          avg_cost_usd: number
          avg_seconds: number
          failed: number
          model: string
          renders: number
          spend_usd: number
          submissions: number
          succeeded: number
          tier: string
        }[]
      }
      admin_overview: { Args: { p_since: string }; Returns: Json }
      admin_recent_renders: {
        Args: { p_limit: number }
        Returns: {
          attempts: number
          cost_usd: number
          created_at: string
          email: string
          error_code: string
          id: string
          mode: string
          model: string
          seconds: number
          status: string
          tier: string
        }[]
      }
      admin_revenue: {
        Args: { p_since: string }
        Returns: {
          amount_cents: number
          item_id: string
          kind: string
          payments: number
        }[]
      }
      admin_users: {
        Args: { p_limit: number; p_search: string }
        Returns: {
          balance: number
          created_at: string
          email: string
          id: string
          plan: string
          renders: number
          revenue_cents: number
        }[]
      }
      claim_render_check: {
        Args: { p_interval_ms: number; p_render_id: string; p_request_id: string }
        Returns: boolean
      }
      claim_render_submission: {
        Args: {
          p_expected_request_id: string
          p_max_attempts: number
          p_render_id: string
          p_stale_seconds: number
        }
        Returns: boolean
      }
      complete_render: {
        Args: {
          p_render_id: string
          p_result_height: number
          p_result_path: string
          p_result_width: number
          p_watermarked_path: string
        }
        Returns: boolean
      }
      credit_balances: {
        Args: { p_user_id: string }
        Returns: {
          free: number
          pack: number
          subscription: number
          total: number
        }[]
      }
      credits_fail_render: {
        Args: {
          p_error_code: string
          p_error_message: string
          p_only_if_past_deadline: boolean
          p_render_id: string
        }
        Returns: {
          balance: number
          changed: boolean
          refunded: number
        }[]
      }
      credits_lock_user: { Args: { p_user_id: string }; Returns: undefined }
      credits_summary: {
        Args: { p_signup_grant: number; p_user_id: string }
        Returns: {
          free: number
          pack: number
          subscription: number
          total: number
        }[]
      }
      expire_credits: {
        Args: { p_bucket: string; p_idempotency_key: string; p_reason?: string; p_user_id: string }
        Returns: number
      }
      fail_render: {
        Args: { p_error_code: string; p_error_message?: string; p_render_id: string }
        Returns: {
          balance: number
          changed: boolean
          refunded: number
        }[]
      }
      fail_stale_render: { Args: { p_render_id: string }; Returns: boolean }
      grant_credits: {
        Args: {
          p_amount: number
          p_bucket: string
          p_idempotency_key: string
          p_kind: string
          p_metadata?: Json
          p_reset_bucket?: boolean
          p_user_id: string
        }
        Returns: boolean
      }
      list_stale_renders: { Args: { p_limit?: number }; Returns: string[] }
      mark_render_submitted: {
        Args: { p_provider_endpoint: string; p_provider_request_id: string; p_render_id: string }
        Returns: boolean
      }
      rate_limit_cleanup: { Args: Record<PropertyKey, never>; Returns: number }
      rate_limit_hit: {
        Args: { p_key: string; p_limit: number; p_window_seconds: number }
        Returns: {
          allowed: boolean
          hits: number
          retry_after: number
        }[]
      }
      start_render: {
        Args: {
          p_client_request_id?: string
          p_cost_usd: number
          p_credits: number
          p_deadline_seconds: number
          p_mode: string
          p_model: string
          p_params: Json
          p_prompt: string
          p_provider: string
          p_room_id: string
          p_source_render_id?: string
          p_tier: string
          p_user_id: string
        }
        Returns: {
          balance: number
          created: boolean
          render_id: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
