// =============================================================
// AUTO-GENERATED — DO NOT EDIT
// =============================================================
//
// Source: Supabase Postgres schema for project lawwsutjxopiekjzupef.
// Regenerate with:
//
//     npm run gen:types
//
// Direct re-export shim that uses these types lives in `./types.ts`.
// Any time you find yourself wanting to edit this file by hand, edit
// `./types.ts` instead — runtime types should live where re-narrowing
// (e.g. tightening CHECK-constrained fields back to union types) is
// already happening.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      agency_accounts: {
        Row: {
          agency_name: string
          created_at: string
          id: string
        }
        Insert: {
          agency_name: string
          created_at?: string
          id: string
        }
        Update: {
          agency_name?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      clients: {
        Row: {
          agency_id: string | null
          client_name: string
          created_at: string
          id: string
          primary_contact_email: string | null
          primary_contact_name: string | null
          website_url: string | null
          workbook_id: number | null
        }
        Insert: {
          agency_id?: string | null
          client_name: string
          created_at?: string
          id?: string
          primary_contact_email?: string | null
          primary_contact_name?: string | null
          website_url?: string | null
          workbook_id?: number | null
        }
        Update: {
          agency_id?: string | null
          client_name?: string
          created_at?: string
          id?: string
          primary_contact_email?: string | null
          primary_contact_name?: string | null
          website_url?: string | null
          workbook_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_answers: {
        Row: {
          answers: Json
          completed: boolean
          id: string
          session_id: string
          step_key: string
          updated_at: string
        }
        Insert: {
          answers?: Json
          completed?: boolean
          id?: string
          session_id: string
          step_key: string
          updated_at?: string
        }
        Update: {
          answers?: Json
          completed?: boolean
          id?: string
          session_id?: string
          step_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_answers_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "onboarding_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_audit_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          payload: Json | null
          session_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          payload?: Json | null
          session_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_audit_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "onboarding_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_field_edits: {
        Row: {
          created_at: string
          edited_at: string
          edited_by_label: string | null
          field_key: string
          id: string
          new_value: Json | null
          old_value: Json | null
          session_id: string
          step_key: string
        }
        Insert: {
          created_at?: string
          edited_at?: string
          edited_by_label?: string | null
          field_key: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          session_id: string
          step_key: string
        }
        Update: {
          created_at?: string
          edited_at?: string
          edited_by_label?: string | null
          field_key?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          session_id?: string
          step_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_field_edits_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "onboarding_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_open_events: {
        Row: {
          created_at: string
          id: string
          ip_hash: string | null
          opened_at: string
          session_id: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ip_hash?: string | null
          opened_at?: string
          session_id: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ip_hash?: string | null
          opened_at?: string
          session_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_open_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "onboarding_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_reminders: {
        Row: {
          created_at: string
          email_body: string
          email_subject: string
          id: string
          kind: string
          sent_at: string
          sent_by_label: string | null
          session_id: string
        }
        Insert: {
          created_at?: string
          email_body: string
          email_subject: string
          id?: string
          kind: string
          sent_at?: string
          sent_by_label?: string | null
          session_id: string
        }
        Update: {
          created_at?: string
          email_body?: string
          email_subject?: string
          id?: string
          kind?: string
          sent_at?: string
          sent_by_label?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_reminders_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "onboarding_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_sessions: {
        Row: {
          account_manager: string | null
          agency_id: string | null
          assigned_to: string | null
          client_id: string
          created_at: string
          crm_status: string
          crm_status_changed_at: string
          current_step: number
          feedback_rating: number | null
          feedback_submitted_at: string | null
          flow_version: string
          id: string
          internal_notes: string | null
          last_saved_at: string | null
          last_viewed_at: string | null
          last_viewed_by: string | null
          logo_path: string | null
          logo_url: string | null
          pin_attempts: number
          pin_hash: string | null
          pin_locked_at: string | null
          pin_lockout_until: string | null
          si_branding_snapshot: Json | null
          si_insights_snapshot: Json | null
          si_overrides_snapshot: Json | null
          si_prefill_snapshot: Json | null
          site_intelligence_id: string | null
          status: string
          submitted_at: string | null
          token: string
          vertical: string
          welcome_wizard_seen: boolean
        }
        Insert: {
          account_manager?: string | null
          agency_id?: string | null
          assigned_to?: string | null
          client_id: string
          created_at?: string
          crm_status?: string
          crm_status_changed_at?: string
          current_step?: number
          feedback_rating?: number | null
          feedback_submitted_at?: string | null
          flow_version?: string
          id?: string
          internal_notes?: string | null
          last_saved_at?: string | null
          last_viewed_at?: string | null
          last_viewed_by?: string | null
          logo_path?: string | null
          logo_url?: string | null
          pin_attempts?: number
          pin_hash?: string | null
          pin_locked_at?: string | null
          pin_lockout_until?: string | null
          si_branding_snapshot?: Json | null
          si_insights_snapshot?: Json | null
          si_overrides_snapshot?: Json | null
          si_prefill_snapshot?: Json | null
          site_intelligence_id?: string | null
          status?: string
          submitted_at?: string | null
          token: string
          vertical?: string
          welcome_wizard_seen?: boolean
        }
        Update: {
          account_manager?: string | null
          agency_id?: string | null
          assigned_to?: string | null
          client_id?: string
          created_at?: string
          crm_status?: string
          crm_status_changed_at?: string
          current_step?: number
          feedback_rating?: number | null
          feedback_submitted_at?: string | null
          flow_version?: string
          id?: string
          internal_notes?: string | null
          last_saved_at?: string | null
          last_viewed_at?: string | null
          last_viewed_by?: string | null
          logo_path?: string | null
          logo_url?: string | null
          pin_attempts?: number
          pin_hash?: string | null
          pin_locked_at?: string | null
          pin_lockout_until?: string | null
          si_branding_snapshot?: Json | null
          si_insights_snapshot?: Json | null
          si_overrides_snapshot?: Json | null
          si_prefill_snapshot?: Json | null
          site_intelligence_id?: string | null
          status?: string
          submitted_at?: string | null
          token?: string
          vertical?: string
          welcome_wizard_seen?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_sessions_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_sessions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_sessions_site_intelligence_id_fkey"
            columns: ["site_intelligence_id"]
            isOneToOne: false
            referencedRelation: "onboarding_site_intelligence"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_site_intelligence: {
        Row: {
          branding: Json | null
          completed_at: string | null
          created_at: string
          domain: string
          error: string | null
          evidence: Json | null
          id: string
          insights: Json | null
          metrics: Json | null
          prefill_map: Json | null
          providers_used: Json
          question_overrides: Json | null
          started_at: string | null
          status: string
          tech_stack: Json | null
          website_url: string
        }
        Insert: {
          branding?: Json | null
          completed_at?: string | null
          created_at?: string
          domain: string
          error?: string | null
          evidence?: Json | null
          id?: string
          insights?: Json | null
          metrics?: Json | null
          prefill_map?: Json | null
          providers_used?: Json
          question_overrides?: Json | null
          started_at?: string | null
          status?: string
          tech_stack?: Json | null
          website_url: string
        }
        Update: {
          branding?: Json | null
          completed_at?: string | null
          created_at?: string
          domain?: string
          error?: string | null
          evidence?: Json | null
          id?: string
          insights?: Json | null
          metrics?: Json | null
          prefill_map?: Json | null
          providers_used?: Json
          question_overrides?: Json | null
          started_at?: string | null
          status?: string
          tech_stack?: Json | null
          website_url?: string
        }
        Relationships: []
      }
      onboarding_sop_routing: {
        Row: {
          big5: Json
          created_at: string
          id: string
          migration: Json
          notes: string | null
          required_sops: string[]
          session_id: string
          updated_at: string
        }
        Insert: {
          big5?: Json
          created_at?: string
          id?: string
          migration?: Json
          notes?: string | null
          required_sops?: string[]
          session_id: string
          updated_at?: string
        }
        Update: {
          big5?: Json
          created_at?: string
          id?: string
          migration?: Json
          notes?: string | null
          required_sops?: string[]
          session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_sop_routing_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "onboarding_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_work_orders: {
        Row: {
          assignees_defaulted: boolean | null
          final_report_status: string | null
          generated_at: string
          id: string
          session_id: string
          tasks: Json
        }
        Insert: {
          assignees_defaulted?: boolean | null
          final_report_status?: string | null
          generated_at?: string
          id?: string
          session_id: string
          tasks?: Json
        }
        Update: {
          assignees_defaulted?: boolean | null
          final_report_status?: string | null
          generated_at?: string
          id?: string
          session_id?: string
          tasks?: Json
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_work_orders_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "onboarding_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          agency_id: string
          created_at: string
          role: string
          user_id: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          role: string
          user_id: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      generate_secure_token: { Args: never; Returns: string }
      is_team_member_of_agency: {
        Args: { p_agency_id: string }
        Returns: boolean
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

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
