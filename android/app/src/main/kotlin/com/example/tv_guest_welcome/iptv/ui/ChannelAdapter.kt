package com.example.tv_guest_welcome.iptv.ui

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.example.tv_guest_welcome.R
import com.example.tv_guest_welcome.iptv.Channel
import com.example.tv_guest_welcome.iptv.ImageLoader
import kotlinx.coroutines.CoroutineScope

class ChannelAdapter(
    private val scope: CoroutineScope,
    private val imageLoader: ImageLoader,
    private val itemWidthDp: Int? = null,
    private val onClick: (Channel, Int) -> Unit
) : RecyclerView.Adapter<ChannelAdapter.VH>() {
    private val items = ArrayList<Channel>()

    fun submit(channels: List<Channel>) {
        items.clear()
        items.addAll(channels)
        notifyDataSetChanged()
    }

    fun getChannels(): List<Channel> = items.toList()

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_channel, parent, false)
        return VH(view)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val item = items[position]
        holder.name.text = item.name
        imageLoader.load(scope, item.logoUrl, holder.logo, android.R.drawable.ic_media_play)
        val lp = holder.root.layoutParams
        if (lp != null) {
            lp.width = itemWidthDp?.let { dp ->
                (dp * holder.root.resources.displayMetrics.density).toInt().coerceAtLeast(1)
            } ?: ViewGroup.LayoutParams.MATCH_PARENT
            holder.root.layoutParams = lp
        }
        holder.root.setOnClickListener { onClick(item, position) }

        val density = holder.root.resources.displayMetrics.density
        val radius = 16f * density
        val stroke = (2f * density).toInt().coerceAtLeast(1)

        val focusedBg = holder.focusedBg ?: GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            intArrayOf(Color.parseColor("#24344B"), Color.parseColor("#152033"))
        ).apply {
            cornerRadius = radius
            setStroke(stroke, Color.parseColor("#FBBF24"))
        }.also { holder.focusedBg = it }

        val normalBg = holder.normalBg ?: GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            intArrayOf(Color.parseColor("#111827"), Color.parseColor("#0B1020"))
        ).apply {
            cornerRadius = radius
            setStroke((1f * density).toInt().coerceAtLeast(1), Color.parseColor("#22304A"))
        }.also { holder.normalBg = it }

        val baseElevation = 2f * density
        val focusedElevation = 10f * density

        fun applyFocusState(hasFocus: Boolean) {
            holder.root.background = if (hasFocus) focusedBg else normalBg
            holder.root.elevation = if (hasFocus) focusedElevation else baseElevation
            holder.root.animate()
                .scaleX(if (hasFocus) 1.08f else 1f)
                .scaleY(if (hasFocus) 1.08f else 1f)
                .setDuration(110)
                .start()
        }

        holder.root.onFocusChangeListener = View.OnFocusChangeListener { _, hasFocus ->
            applyFocusState(hasFocus)
        }
        applyFocusState(holder.root.isFocused)

        if (!holder.didEnterAnim) {
            holder.didEnterAnim = true
            val dy = 10f * density
            holder.root.animate().cancel()
            holder.root.alpha = 0f
            holder.root.translationY = dy
            holder.root.animate()
                .alpha(1f)
                .translationY(0f)
                .setDuration(180)
                .setStartDelay(((position % 12) * 12).toLong())
                .start()
        }
    }

    override fun getItemCount(): Int = items.size

    class VH(view: View) : RecyclerView.ViewHolder(view) {
        val root: View = view
        val logo: ImageView = view.findViewById(R.id.channel_logo)
        val name: TextView = view.findViewById(R.id.channel_name)
        var focusedBg: GradientDrawable? = null
        var normalBg: GradientDrawable? = null
        var didEnterAnim: Boolean = false
    }
}
