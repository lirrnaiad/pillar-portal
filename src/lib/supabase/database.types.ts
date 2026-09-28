export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      activity: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          op_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          op_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          op_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "member_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      desks: {
        Row: {
          id: string
          name: string
          production_role: Database["public"]["Enums"]["production_role"]
          sort_order: number
        }
        Insert: {
          id: string
          name: string
          production_role: Database["public"]["Enums"]["production_role"]
          sort_order: number
        }
        Update: {
          id?: string
          name?: string
          production_role?: Database["public"]["Enums"]["production_role"]
          sort_order?: number
        }
        Relationships: []
      }
      member_positions: {
        Row: {
          is_primary: boolean
          member_id: string
          position: string
        }
        Insert: {
          is_primary?: boolean
          member_id: string
          position: string
        }
        Update: {
          is_primary?: boolean
          member_id?: string
          position?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_positions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_positions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_positions_position_fkey"
            columns: ["position"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          id: string
          name: string
          role: Database["public"]["Enums"]["member_role"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          id: string
          name: string
          role?: Database["public"]["Enums"]["member_role"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          id?: string
          name?: string
          role?: Database["public"]["Enums"]["member_role"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "members_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "member_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      positions: {
        Row: {
          desk_id: string | null
          heads_desk_id: string | null
          heads_section_id: string | null
          id: string
          is_board: boolean
          is_top_editor: boolean
          report_title: string
          sort_order: number
          title: string
        }
        Insert: {
          desk_id?: string | null
          heads_desk_id?: string | null
          heads_section_id?: string | null
          id: string
          is_board?: boolean
          is_top_editor?: boolean
          report_title: string
          sort_order: number
          title: string
        }
        Update: {
          desk_id?: string | null
          heads_desk_id?: string | null
          heads_section_id?: string | null
          id?: string
          is_board?: boolean
          is_top_editor?: boolean
          report_title?: string
          sort_order?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "positions_desk_id_fkey"
            columns: ["desk_id"]
            isOneToOne: false
            referencedRelation: "desks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "positions_heads_desk_id_fkey"
            columns: ["heads_desk_id"]
            isOneToOne: false
            referencedRelation: "desks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "positions_heads_section_id_fkey"
            columns: ["heads_section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
      sections: {
        Row: {
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          id: string
          name: string
          sort_order: number
        }
        Update: {
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      task_assignments: {
        Row: {
          created_at: string
          id: string
          member_id: string
          role: Database["public"]["Enums"]["production_role"]
          state: Database["public"]["Enums"]["slot_state"]
          task_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          member_id: string
          role: Database["public"]["Enums"]["production_role"]
          state?: Database["public"]["Enums"]["slot_state"]
          task_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          member_id?: string
          role?: Database["public"]["Enums"]["production_role"]
          state?: Database["public"]["Enums"]["slot_state"]
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          column: Database["public"]["Enums"]["task_column"]
          created_at: string
          created_by: string | null
          description: string | null
          due_at: string
          id: string
          owning_desk_id: string | null
          owning_section_id: string | null
          reference_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          column?: Database["public"]["Enums"]["task_column"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at: string
          id?: string
          owning_desk_id?: string | null
          owning_section_id?: string | null
          reference_url?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          column?: Database["public"]["Enums"]["task_column"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string
          id?: string
          owning_desk_id?: string | null
          owning_section_id?: string | null
          reference_url?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "member_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_owning_desk_id_fkey"
            columns: ["owning_desk_id"]
            isOneToOne: false
            referencedRelation: "desks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_owning_section_id_fkey"
            columns: ["owning_section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      member_directory: {
        Row: {
          avatar_url: string | null
          id: string | null
          name: string | null
          positions: Json | null
        }
        Relationships: []
      }
    }
    Functions: {
      create_task: {
        Args: {
          description: string
          due_at: string
          owning_desk_id: string
          owning_section_id: string
          reference_url: string
          slots: Json
          title: string
        }
        Returns: string
      }
    }
    Enums: {
      member_role: "pending" | "staff" | "editorial_admin"
      production_role:
        | "writer"
        | "layout_artist"
        | "cartoonist"
        | "photojournalist"
        | "broadcast_journalist"
        | "videojournalist"
      slot_state: "awaiting_response" | "on_it" | "needs_reassignment"
      task_column: "to_do" | "doing" | "for_review" | "done"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      member_role: ["pending", "staff", "editorial_admin"],
      production_role: [
        "writer",
        "layout_artist",
        "cartoonist",
        "photojournalist",
        "broadcast_journalist",
        "videojournalist",
      ],
      slot_state: ["awaiting_response", "on_it", "needs_reassignment"],
      task_column: ["to_do", "doing", "for_review", "done"],
    },
  },
} as const

