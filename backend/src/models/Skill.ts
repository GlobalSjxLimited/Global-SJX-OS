import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';

const skillSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    category: { type: String },
    description: { type: String },
  },
  { timestamps: true }
);

skillSchema.plugin(softDeletePlugin);
export const Skill = model('Skill', skillSchema);

/** Per-employee skill proficiency (separate from the Skill catalog above). */
const employeeSkillSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    skillId: { type: Schema.Types.ObjectId, ref: 'Skill', required: true },
    proficiency: { type: String, enum: ['beginner', 'intermediate', 'advanced', 'expert'], default: 'beginner' },
    validatedByCertificationId: { type: Schema.Types.ObjectId, ref: 'Certification' },
  },
  { timestamps: true }
);
employeeSkillSchema.index({ userId: 1, skillId: 1 }, { unique: true });

employeeSkillSchema.plugin(softDeletePlugin);
export const EmployeeSkill = model('EmployeeSkill', employeeSkillSchema);
