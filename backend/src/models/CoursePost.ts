import { Schema, model } from 'mongoose';
import { softDeletePlugin } from '../utils/softDeletePlugin';

const coursePostSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true },
    parentPostId: { type: Schema.Types.ObjectId, ref: 'CoursePost' }, // set for a reply — replies inherit the parent's visibility

    // Who can see this post, beyond the author and course instructors/managers
    // (who can always see everything):
    //  - public: everyone enrolled in the course
    //  - private: nobody but the author and instructors — effectively a note to the instructor
    //  - user: the author plus one specific person (targetUserId)
    //  - group: the author plus every member of one of the course's own group projects (targetCourseGroupId)
    visibility: { type: String, enum: ['public', 'private', 'user', 'group'], default: 'public' },
    targetUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    targetCourseGroupId: { type: Schema.Types.ObjectId }, // subdocument _id within Course.courseGroups
  },
  { timestamps: true }
);

coursePostSchema.index({ courseId: 1, parentPostId: 1, createdAt: -1 });
coursePostSchema.plugin(softDeletePlugin);
export const CoursePost = model('CoursePost', coursePostSchema);
