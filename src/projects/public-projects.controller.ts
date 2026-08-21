import {
  Controller,
  Get,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiResponse } from '@nestjs/swagger';
import { PublicProjectsService } from './public-projects.service';
import { PublicProjectDto } from './dto/public-project.dto';

/**
 * UNAUTHENTICATED endpoints powering the `/p/:slug` public landing
 * page and the `/templates` gallery in the SPA. These intentionally
 * skip both `AuthGuard` and `RolesGuard` so they can be linked to and
 * crawled by search engines.
 *
 * Everything here returns the redacted `PublicProjectDto` — never the
 * owner email, Supabase keys, payment keys, or any private field.
 */
@ApiTags('Public Projects')
@Controller('public')
export class PublicProjectsController {
  constructor(private readonly publicProjectsService: PublicProjectsService) {}

  @ApiOperation({ summary: 'Fetch a published project by its slug' })
  @ApiResponse({ status: 200, type: PublicProjectDto })
  @Get('projects/:slug')
  @HttpCode(HttpStatus.OK)
  async getBySlug(
    @Param('slug') slug: string,
  ): Promise<{ data: PublicProjectDto }> {
    const data = await this.publicProjectsService.getPublicProjectBySlug(slug);
    return { data };
  }

  @ApiOperation({ summary: 'List admin-curated templates' })
  @ApiResponse({ status: 200, type: [PublicProjectDto] })
  @Get('templates')
  @HttpCode(HttpStatus.OK)
  async listTemplates(
    @Query('category') category?: string,
  ): Promise<{ data: PublicProjectDto[] }> {
    const data = await this.publicProjectsService.listPublicTemplates(category);
    return { data };
  }

  @ApiOperation({ summary: 'List distinct template categories' })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: { data: { type: 'array', items: { type: 'string' } } },
    },
  })
  @Get('templates/categories')
  @HttpCode(HttpStatus.OK)
  async listCategories(): Promise<{ data: string[] }> {
    const data = await this.publicProjectsService.listTemplateCategories();
    return { data };
  }
}
