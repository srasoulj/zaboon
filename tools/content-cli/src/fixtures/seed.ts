/**
 * Test seed for the media pipeline tests: a private copy of the seed course WITHOUT generated media
 * (see ./seed-course.ts — frozen seed text, hand-made art, no assets/audio or assets/img), so tests
 * don't depend on which clips and illustrations the live course has.
 */
import { join } from 'node:path'
import { seedCourseCopy } from './seed-course'

/** Copies the seed course to `<root>/fa-en` without generated media; returns the course dir. */
export function seedCourseWithoutMedia(root: string): string {
  return seedCourseCopy(join(root, 'fa-en'))
}
