export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      action_items: {
        Row: {
          assignee: string | null;
          assignee_user_id: string | null;
          canonical_key: string | null;
          created_at: string;
          deadline: string | null;
          id: string;
          meeting_id: string;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          assignee?: string | null;
          assignee_user_id?: string | null;
          canonical_key?: string | null;
          created_at?: string;
          deadline?: string | null;
          id?: string;
          meeting_id: string;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          assignee?: string | null;
          assignee_user_id?: string | null;
          canonical_key?: string | null;
          created_at?: string;
          deadline?: string | null;
          id?: string;
          meeting_id?: string;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "action_items_meeting_id_fkey";
            columns: ["meeting_id"];
            isOneToOne: false;
            referencedRelation: "meetings";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_summaries: {
        Row: {
          created_at: string;
          executive_summary: string | null;
          follow_ups: Json | null;
          id: string;
          key_points: Json | null;
          meeting_id: string;
          risks: Json | null;
        };
        Insert: {
          created_at?: string;
          executive_summary?: string | null;
          follow_ups?: Json | null;
          id?: string;
          key_points?: Json | null;
          meeting_id: string;
          risks?: Json | null;
        };
        Update: {
          created_at?: string;
          executive_summary?: string | null;
          follow_ups?: Json | null;
          id?: string;
          key_points?: Json | null;
          meeting_id?: string;
          risks?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "ai_summaries_meeting_id_fkey";
            columns: ["meeting_id"];
            isOneToOne: true;
            referencedRelation: "meetings";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_usage: {
        Row: {
          created_at: string;
          duration_ms: number | null;
          fn: string;
          id: string;
          model: string | null;
          ok: boolean;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          duration_ms?: number | null;
          fn: string;
          id?: string;
          model?: string | null;
          ok?: boolean;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          duration_ms?: number | null;
          fn?: string;
          id?: string;
          model?: string | null;
          ok?: boolean;
          user_id?: string;
        };
        Relationships: [];
      };
      chat_messages: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          role: string;
          user_id: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          id?: string;
          role: string;
          user_id?: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      decisions: {
        Row: {
          created_at: string;
          description: string;
          id: string;
          made_by: string | null;
          meeting_id: string;
        };
        Insert: {
          created_at?: string;
          description: string;
          id?: string;
          made_by?: string | null;
          meeting_id: string;
        };
        Update: {
          created_at?: string;
          description?: string;
          id?: string;
          made_by?: string | null;
          meeting_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "decisions_meeting_id_fkey";
            columns: ["meeting_id"];
            isOneToOne: false;
            referencedRelation: "meetings";
            referencedColumns: ["id"];
          },
        ];
      };
      meetings: {
        Row: {
          created_at: string;
          duration_seconds: number | null;
          ended_at: string | null;
          google_event_id: string | null;
          host_id: string;
          id: string;
          meeting_link: string | null;
          platform: string;
          project_id: string | null;
          reminder_sent_at: string | null;
          scheduled_at: string | null;
          started_at: string | null;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          duration_seconds?: number | null;
          ended_at?: string | null;
          google_event_id?: string | null;
          host_id: string;
          id?: string;
          meeting_link?: string | null;
          platform?: string;
          project_id?: string | null;
          reminder_sent_at?: string | null;
          scheduled_at?: string | null;
          started_at?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          duration_seconds?: number | null;
          ended_at?: string | null;
          google_event_id?: string | null;
          host_id?: string;
          id?: string;
          meeting_link?: string | null;
          platform?: string;
          project_id?: string | null;
          reminder_sent_at?: string | null;
          scheduled_at?: string | null;
          started_at?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "meetings_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          body: string | null;
          created_at: string;
          id: string;
          link: string | null;
          read: boolean;
          title: string;
          type: string;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          id?: string;
          link?: string | null;
          read?: boolean;
          title: string;
          type: string;
          user_id: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          id?: string;
          link?: string | null;
          read?: boolean;
          title?: string;
          type?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      participants: {
        Row: {
          created_at: string;
          email: string | null;
          id: string;
          meeting_id: string;
          name: string;
          role: string | null;
        };
        Insert: {
          created_at?: string;
          email?: string | null;
          id?: string;
          meeting_id: string;
          name: string;
          role?: string | null;
        };
        Update: {
          created_at?: string;
          email?: string | null;
          id?: string;
          meeting_id?: string;
          name?: string;
          role?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "participants_meeting_id_fkey";
            columns: ["meeting_id"];
            isOneToOne: false;
            referencedRelation: "meetings";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          company: string | null;
          created_at: string;
          email: string | null;
          full_name: string | null;
          id: string;
          is_active: boolean;
          language: string | null;
          subscription_plan: string;
          time_zone: string | null;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          company?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id: string;
          is_active?: boolean;
          language?: string | null;
          subscription_plan?: string;
          time_zone?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          company?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          is_active?: boolean;
          language?: string | null;
          subscription_plan?: string;
          time_zone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      projects: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          owner_id: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          owner_id: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          owner_id?: string;
        };
        Relationships: [];
      };
      transcripts: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          meeting_id: string;
          segment_index: number;
          speaker: string;
          spoken_at: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          id?: string;
          meeting_id: string;
          segment_index?: number;
          speaker: string;
          spoken_at?: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          meeting_id?: string;
          segment_index?: number;
          speaker?: string;
          spoken_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "transcripts_meeting_id_fkey";
            columns: ["meeting_id"];
            isOneToOne: false;
            referencedRelation: "meetings";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      admin_ai_usage: { Args: never; Returns: Json };
      admin_list_meetings: {
        Args: never;
        Returns: {
          created_at: string;
          has_summary: boolean;
          host_email: string;
          host_name: string;
          id: string;
          scheduled_at: string;
          status: string;
          title: string;
          transcript_count: number;
        }[];
      };
      admin_list_users: {
        Args: never;
        Returns: {
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          is_active: boolean;
          is_admin: boolean;
          last_sign_in_at: string;
          meeting_count: number;
        }[];
      };
      admin_overview: { Args: never; Returns: Json };
      admin_set_user_active: {
        Args: { active: boolean; target: string };
        Returns: undefined;
      };
      admin_set_user_role: {
        Args: { make_admin: boolean; target: string };
        Returns: undefined;
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      is_active_user: { Args: never; Returns: boolean };
      is_admin: { Args: never; Returns: boolean };
      my_open_task_count: { Args: never; Returns: number };
      search_workspace: {
        Args: { q: string };
        Returns: {
          kind: string;
          meeting_id: string;
          meeting_title: string;
          occurred_at: string;
          snippet: string;
        }[];
      };
      seed_demo_workspace: { Args: never; Returns: Json };
    };
    Enums: {
      app_role: "admin" | "user";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const;
